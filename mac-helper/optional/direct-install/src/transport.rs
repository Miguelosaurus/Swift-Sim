use idevice::{
    RsdService,
    afc::{AfcClient, opcode::AfcFopenMode},
    installation_proxy::InstallationProxyClient,
    remote_pairing::{
        RemotePairingClient, RpPairingFile, RpPairingSocket, connect_tls_psk_tunnel_native,
    },
    rsd::RsdHandshake,
    tcp::adapter::Adapter,
};
use sha2::{Digest, Sha256};
use std::{net::IpAddr, path::PathBuf};
use swift_sim_direct_install::{Device, Identity, Result};
use tokio::{io::AsyncReadExt, net::TcpStream};

pub struct Transport {
    inst: InstallationProxyClient,
    afc: AfcClient,
    ipa: PathBuf,
    sha: String,
}

impl Transport {
    pub async fn connect(
        host: IpAddr,
        port: u16,
        udid: &str,
        mut pairing: RpPairingFile,
        ipa: PathBuf,
        sha: String,
    ) -> Result<Self> {
        let stream = TcpStream::connect((host, port))
            .await
            .map_err(|_| "pairing_port_unreachable")?;
        let mut client =
            RemotePairingClient::new(RpPairingSocket::new(stream), "Swift Sim Direct Install");
        client
            .attempt_pair_verify()
            .await
            .map_err(|_| "pair_verify_handshake_failed")?;
        client
            .validate_pairing(&mut pairing)
            .await
            .map_err(|_| "peer_authentication_failed")?;
        let port = client
            .create_tcp_listener()
            .await
            .map_err(|_| "tunnel_unavailable")?;
        let stream = TcpStream::connect((host, port))
            .await
            .map_err(|_| "tunnel_unreachable")?;
        let tunnel = connect_tls_psk_tunnel_native(stream, client.encryption_key())
            .await
            .map_err(|_| "tunnel_authentication_failed")?;
        let info = tunnel.info.clone();
        let mut adapter = Adapter::new(
            Box::new(tunnel.into_inner()),
            info.client_address.parse().map_err(|_| "invalid_tunnel")?,
            info.server_address.parse().map_err(|_| "invalid_tunnel")?,
        );
        adapter.set_mss((info.mtu as usize).saturating_sub(60));
        let mut handle = adapter.to_async_handle();
        let stream = handle
            .connect(info.server_rsd_port)
            .await
            .map_err(|_| "rsd_unreachable")?;
        let mut handshake = RsdHandshake::new(stream).await.map_err(|_| "rsd_failed")?;
        if handshake
            .properties
            .get("UniqueDeviceID")
            .and_then(|v| v.as_string())
            != Some(udid)
        {
            return Err("device_identity_mismatch");
        }
        let inst = InstallationProxyClient::connect_rsd(&mut handle, &mut handshake)
            .await
            .map_err(|_| "installer_service_unavailable")?;
        let afc = AfcClient::connect_rsd(&mut handle, &mut handshake)
            .await
            .map_err(|_| "staging_service_unavailable")?;
        Ok(Self {
            inst,
            afc,
            ipa,
            sha,
        })
    }
}

impl Device for Transport {
    async fn lookup(&mut self, bundle: &str) -> Result<Option<Identity>> {
        let apps = self
            .inst
            .get_apps(Some("User"), Some(vec![bundle.into()]))
            .await
            .map_err(|_| "inventory_unavailable")?;
        let Some(app) = apps.get(bundle) else {
            return Ok(None);
        };
        let value = |key| {
            app.as_dictionary()
                .and_then(|d| d.get(key))
                .and_then(|v| v.as_string())
                .map(str::to_owned)
                .ok_or("inventory_identity_missing")
        };
        Ok(Some(Identity {
            bundle: value("CFBundleIdentifier")?,
            build: value("CFBundleVersion")?,
            version: value("CFBundleShortVersionString")?,
        }))
    }

    async fn upload(&mut self, staging: &str) -> Result<()> {
        if self.afc.get_file_info("PublicStaging").await.is_err() {
            self.afc
                .mk_dir("PublicStaging")
                .await
                .map_err(|_| "staging_unavailable")?;
        }
        let mut source = tokio::fs::File::open(&self.ipa)
            .await
            .map_err(|_| "artifact_unavailable")?;
        let mut target = self
            .afc
            .open(staging, AfcFopenMode::WrOnly)
            .await
            .map_err(|_| "staging_open_failed")?;
        let mut buffer = [0_u8; 65536];
        let mut hash = Sha256::new();
        let result = async {
            loop {
                let n = source
                    .read(&mut buffer)
                    .await
                    .map_err(|_| "artifact_read_failed")?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
                target
                    .write_entire(&buffer[..n])
                    .await
                    .map_err(|_| "upload_failed")?;
            }
            if format!("{:x}", hash.finalize()) != self.sha {
                return Err("artifact_changed");
            }
            Ok(())
        }
        .await;
        let closed = target.close().await.map_err(|_| "staging_close_failed");
        result.and(closed)
    }

    async fn install(&mut self, staging: &str, bundle: &str) -> Result<()> {
        // Preserve the app/container identity. No uninstall, provisioning change, or launch.
        let mut options = plist::Dictionary::new();
        options.insert(
            "CFBundleIdentifier".into(),
            plist::Value::String(bundle.into()),
        );
        self.inst
            .install(staging, Some(plist::Value::Dictionary(options)))
            .await
            .map_err(|_| "install_unconfirmed_no_retry")
    }

    async fn remove(&mut self, staging: &str) -> Result<()> {
        match self.afc.remove(staging).await {
            Ok(())
            | Err(idevice::IdeviceError::Afc(idevice::afc::errors::AfcError::ObjectNotFound)) => {
                Ok(())
            }
            Err(_) => Err("staging_cleanup_pending"),
        }
    }

    async fn staging_absent(&mut self, staging: &str) -> Result<bool> {
        match self.afc.get_file_info(staging).await {
            Ok(_) => Ok(false),
            Err(idevice::IdeviceError::Afc(idevice::afc::errors::AfcError::ObjectNotFound)) => {
                Ok(true)
            }
            Err(_) => Err("staging_status_unavailable"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use idevice::Idevice;
    use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};

    fn dictionary(values: &[(&str, plist::Value)]) -> plist::Dictionary {
        values
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    async fn read(server: &mut DuplexStream) -> plist::Dictionary {
        let size = server.read_u32().await.unwrap();
        assert!(size < 16384);
        let mut bytes = vec![0; size as usize];
        server.read_exact(&mut bytes).await.unwrap();
        plist::Value::from_reader(std::io::Cursor::new(bytes))
            .unwrap()
            .into_dictionary()
            .unwrap()
    }
    async fn send(server: &mut DuplexStream, value: plist::Dictionary) {
        let mut bytes = Vec::new();
        plist::Value::Dictionary(value)
            .to_writer_xml(&mut bytes)
            .unwrap();
        server.write_u32(bytes.len() as u32).await.unwrap();
        server.write_all(&bytes).await.unwrap();
    }

    async fn read_afc(server: &mut DuplexStream) -> (u64, u64, Vec<u8>, Vec<u8>) {
        let magic = server.read_u64_le().await.unwrap();
        assert_eq!(magic, idevice::afc::MAGIC);
        let total = server.read_u64_le().await.unwrap();
        let header = server.read_u64_le().await.unwrap();
        let number = server.read_u64_le().await.unwrap();
        let operation = server.read_u64_le().await.unwrap();
        assert!((40..=total).contains(&header) && total <= 65584);
        let mut args = vec![0; (header - 40) as usize];
        let mut bytes = vec![0; (total - header) as usize];
        server.read_exact(&mut args).await.unwrap();
        server.read_exact(&mut bytes).await.unwrap();
        (number, operation, args, bytes)
    }

    async fn send_afc(
        server: &mut DuplexStream,
        number: u64,
        operation: u64,
        args: &[u8],
        bytes: &[u8],
    ) {
        for value in [
            idevice::afc::MAGIC,
            40 + args.len() as u64 + bytes.len() as u64,
            40 + args.len() as u64,
            number,
            operation,
        ] {
            server.write_u64_le(value).await.unwrap();
        }
        server.write_all(args).await.unwrap();
        server.write_all(bytes).await.unwrap();
    }

    async fn upload_fixture(wrong_digest: bool, fail_write: bool) {
        let path =
            std::env::temp_dir().join(format!("swift-sim-upload-fixture-{}", uuid::Uuid::new_v4()));
        let content: Vec<_> = (0..(65536 * 2 + 31)).map(|n| (n % 251) as u8).collect();
        std::fs::write(&path, &content).unwrap();
        let expected_digest = if wrong_digest {
            "0".repeat(64)
        } else {
            format!("{:x}", Sha256::digest(&content))
        };
        let (client, server) = tokio::io::duplex(4096);
        let (inst, _unused) = tokio::io::duplex(1024);
        let mut device = Transport {
            inst: InstallationProxyClient::new(Idevice::new(Box::new(inst), "fixture")),
            afc: AfcClient::new(Idevice::new(Box::new(client), "fixture")),
            ipa: path.clone(),
            sha: expected_digest,
        };
        let fixture = tokio::spawn(async move {
            let mut server = server;
            let (number, operation, args, _) = read_afc(&mut server).await;
            assert_eq!(operation, 10); // GetFileInfo
            assert_eq!(args, b"PublicStaging");
            let info = b"st_size\x000\0st_blocks\x000\0st_birthtime\x000\0st_mtime\x000\0st_nlink\x001\0st_ifmt\0S_IFDIR\0";
            send_afc(&mut server, number, 2, &[], info).await;
            let (number, operation, args, _) = read_afc(&mut server).await;
            assert_eq!(operation, 13); // FileOpen
            assert_eq!(&args[8..], b"PublicStaging/fixture.ipa");
            assert_eq!(u64::from_le_bytes(args[..8].try_into().unwrap()), 3); // WrOnly
            send_afc(&mut server, number, 14, &17_u64.to_le_bytes(), &[]).await;
            let mut received = vec![];
            let mut chunks = 0;
            loop {
                let (number, operation, args, bytes) = read_afc(&mut server).await;
                assert_eq!(args, 17_u64.to_le_bytes());
                if operation == 20 {
                    // FileClose must happen after success or write/hash failure.
                    send_afc(&mut server, number, 1, &0_u64.to_le_bytes(), &[]).await;
                    break;
                }
                assert_eq!(operation, 16); // Write
                assert!(!bytes.is_empty() && bytes.len() <= 65536);
                assert!(!fail_write || chunks == 0); // No second write after rejection.
                chunks += 1;
                received.extend(bytes);
                send_afc(
                    &mut server,
                    number,
                    1,
                    &(if fail_write { 4_u64 } else { 0_u64 }).to_le_bytes(),
                    &[],
                )
                .await;
            }
            (received, chunks)
        });
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            device.upload("PublicStaging/fixture.ipa"),
        )
        .await
        .unwrap();
        let (received, chunks) = fixture.await.unwrap();
        if fail_write {
            assert_eq!(result, Err("upload_failed"));
            assert_eq!(chunks, 1);
        } else {
            assert_eq!(received, content);
            assert_eq!(chunks, 3);
            assert_eq!(
                result,
                if wrong_digest {
                    Err("artifact_changed")
                } else {
                    Ok(())
                }
            );
        }
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn real_afc_streams_bounded_chunks_and_closes() {
        upload_fixture(false, false).await;
    }

    #[tokio::test]
    async fn real_afc_digest_mismatch_closes_without_install() {
        upload_fixture(true, false).await;
    }

    #[tokio::test]
    async fn real_afc_rejected_write_stops_and_closes() {
        upload_fixture(false, true).await;
    }

    // Exercise the real provider's framed plist protocol, entirely in memory.
    #[tokio::test]
    async fn real_install_completion_then_scoped_lookup() {
        let (client, server) = tokio::io::duplex(16384);
        let (afc, _unused) = tokio::io::duplex(1024);
        let mut device = Transport {
            inst: InstallationProxyClient::new(Idevice::new(Box::new(client), "fixture")),
            afc: AfcClient::new(Idevice::new(Box::new(afc), "fixture")),
            ipa: PathBuf::new(),
            sha: String::new(),
        };
        let fixture = tokio::spawn(async move {
            let mut server = server;
            let request = read(&mut server).await;
            assert_eq!(request["Command"].as_string(), Some("Install"));
            assert_eq!(
                request["PackagePath"].as_string(),
                Some("PublicStaging/fixture.ipa")
            );
            send(
                &mut server,
                dictionary(&[
                    ("Status", "Installing".into()),
                    ("PercentComplete", 80_u64.into()),
                ]),
            )
            .await;
            send(&mut server, dictionary(&[("Status", "Complete".into())])).await;
            let request = read(&mut server).await;
            assert_eq!(request["Command"].as_string(), Some("Lookup"));
            let options = request["ClientOptions"].as_dictionary().unwrap();
            assert_eq!(
                options["BundleIDs"].as_array().unwrap(),
                &vec![plist::Value::String("example.Test".into())]
            );
            let app = dictionary(&[
                ("CFBundleIdentifier", "example.Test".into()),
                ("CFBundleVersion", "2".into()),
                ("CFBundleShortVersionString", "1.0".into()),
            ]);
            let lookup = dictionary(&[("example.Test", plist::Value::Dictionary(app))]);
            send(
                &mut server,
                dictionary(&[("LookupResult", plist::Value::Dictionary(lookup))]),
            )
            .await;
        });
        device
            .install("PublicStaging/fixture.ipa", "example.Test")
            .await
            .unwrap();
        assert_eq!(
            device.lookup("example.Test").await.unwrap().unwrap().build,
            "2"
        );
        fixture.await.unwrap();
    }
}
