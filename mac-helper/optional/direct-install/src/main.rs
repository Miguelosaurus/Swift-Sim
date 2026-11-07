mod transport;

use fs2::FileExt;
use idevice::remote_pairing::RpPairingFile;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::IpAddr,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use swift_sim_direct_install::{Device, Identity, Journal, Result, run};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u8,
    sha256: String,
    identity: Identity,
    team: String,
    devices: Vec<String>,
    expires: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Peer {
    host: IpAddr,
    port: u16,
    udid: String,
    pairing_file: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn private(path: &Path, directory: bool) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|_| "private_input_unavailable")?;
    if meta.file_type().is_symlink()
        || (!directory && !meta.is_file())
        || meta.is_dir() != directory
        || meta.permissions().mode() & 0o077 != 0
    {
        return Err("requires_private_regular_input");
    }
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    private(path, false)?;
    let file = File::open(path).map_err(|_| "input_unavailable")?;
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "input_read_failed")?;
    if bytes.len() > 65536 {
        return Err("input_too_large");
    }
    serde_json::from_slice(&bytes).map_err(|_| "invalid_input")
}

fn manifest(path: &Path) -> Result<Manifest> {
    private(path, true)?;
    let value: Manifest = read_json(&path.join("manifest.json"))?;
    if value.schema != 1
        || value.sha256.len() != 64
        || !value.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || value.team.is_empty()
        || value.devices.is_empty()
        || [
            &value.identity.bundle,
            &value.identity.build,
            &value.identity.version,
        ]
        .iter()
        .any(|v| v.is_empty() || v.len() > 255)
        || value.identity.bundle.contains(['/', '*'])
    {
        return Err("invalid_manifest");
    }
    if value.expires
        <= SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "clock_unavailable")?
            .as_secs()
    {
        return Err("profile_expired");
    }
    private(&path.join("signed.ipa"), false)?;
    let mut source = File::open(path.join("signed.ipa")).map_err(|_| "artifact_unavailable")?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let n = source
            .read(&mut buffer)
            .map_err(|_| "artifact_read_failed")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != value.sha256 {
        return Err("artifact_changed");
    }
    Ok(value)
}

fn tailnet(host: IpAddr) -> bool {
    match host {
        IpAddr::V4(ip) => u32::from(ip) & 0xffc00000 == 0x64400000,
        IpAddr::V6(ip) => ip.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0],
    }
}

fn save(path: &Path, journal: &Journal) -> Result<()> {
    // Same-directory rename plus fsync. The per-target advisory lock survives process errors.
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| "journal_write_failed")?;
        file.write_all(&serde_json::to_vec(journal).map_err(|_| "journal_encode_failed")?)
            .map_err(|_| "journal_write_failed")?;
        file.sync_all().map_err(|_| "journal_sync_failed")?;
        fs::rename(&temp, path).map_err(|_| "journal_rename_failed")?;
        File::open(path.parent().ok_or("journal_parent_missing")?)
            .and_then(|f| f.sync_all())
            .map_err(|_| "journal_sync_failed")
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

async fn execute(args: &[String]) -> Result<serde_json::Value> {
    let action = args.get(1).map(String::as_str).ok_or("usage")?;
    if !["validate", "inspect", "install", "reconcile"].contains(&action) {
        return Err("usage");
    }
    let prepared = Path::new(args.get(2).ok_or("usage")?);
    let manifest = manifest(prepared)?;
    if action == "validate" && args.len() == 3 {
        return Ok(json!({"ok":true,"state":"validated-offline","deviceContacted":false}));
    }
    if args.len() != 6 || args[5] != "--execute" {
        return Err("explicit_execute_required");
    }
    let peer: Peer = read_json(Path::new(&args[3]))?;
    if !tailnet(peer.host) || peer.port == 0 {
        return Err("explicit_tailnet_peer_required");
    }
    if !manifest.devices.contains(&peer.udid) {
        return Err("device_not_in_signed_profile");
    }
    private(Path::new(&peer.pairing_file), false)?;
    let pairing = RpPairingFile::read_from_file(&peer.pairing_file)
        .await
        .map_err(|_| "invalid_pairing_record")?;
    let public = pairing
        .peer_public_key
        .as_ref()
        .ok_or("pinned_peer_required")?;
    let identifier = pairing
        .peer_identifier
        .as_ref()
        .ok_or("pinned_peer_required")?;
    let target_key = digest(
        &serde_json::to_vec(&(
            public.to_bytes(),
            identifier,
            &peer.udid,
            &manifest.identity.bundle,
        ))
        .map_err(|_| "invalid_binding")?,
    );
    let binding = digest(
        &serde_json::to_vec(&(
            &target_key,
            &manifest.sha256,
            &manifest.identity,
            &manifest.team,
        ))
        .map_err(|_| "invalid_binding")?,
    );
    let state = Path::new(&args[4]);
    if !state.exists() {
        fs::create_dir(state).map_err(|_| "state_create_failed")?;
        fs::set_permissions(state, fs::Permissions::from_mode(0o700))
            .map_err(|_| "state_permissions_failed")?;
        // The new state directory itself must survive a crash before its journal
        // can serve as a durable submission fence.
        let parent = state
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| "state_sync_failed")?;
    }
    private(state, true)?;
    let lock_path = state.join(format!("{target_key}.lock"));
    if lock_path.exists() {
        private(&lock_path, false)?;
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(lock_path)
        .map_err(|_| "lock_failed")?;
    lock.try_lock_exclusive()
        .map_err(|_| "install_already_running")?;
    let journal_path = state.join(format!("{target_key}.json"));
    let mut journal: Journal = if journal_path.exists() {
        let old: Journal = read_json(&journal_path)?;
        if old.schema != 1 || !valid_staging(&old.staging) {
            return Err("invalid_journal");
        }
        if old.binding == binding {
            old
        } else {
            if !["verified", "not-submitted"].contains(&old.phase.as_str()) || old.cleanup_pending {
                return Err("previous_install_requires_reconciliation");
            }
            if old.target == manifest.identity {
                return Err("build_number_reused");
            }
            new_journal(binding, manifest.identity.clone())
        }
    } else {
        new_journal(binding, manifest.identity.clone())
    };
    if journal.target != manifest.identity {
        return Err("journal_identity_mismatch");
    }
    // No tracing subscriber: provider diagnostics can include pairing information.
    let result = tokio::time::timeout(Duration::from_secs(600), async {
        let mut device = tokio::time::timeout(Duration::from_secs(30), transport::Transport::connect(
            peer.host, peer.port, &peer.udid, pairing, prepared.join("signed.ipa"), manifest.sha256,
        )).await.map_err(|_| "connection_timeout")??;
        if action == "inspect" {
            let observed = device.lookup(&journal.target.bundle).await?;
            return Ok(json!({"ok":true,"state":"installer-reachable","matchingVersion":observed.as_ref()==Some(&journal.target)}));
        }
        let outcome = run(&mut journal, &mut device, action == "reconcile", |j| save(&journal_path, j)).await?;
        Ok(json!({"ok":true,"state":outcome,"cleanupPending":journal.cleanup_pending}))
    }).await.map_err(|_| "timeout_reconcile_before_retry")?;
    drop(lock);
    result
}

fn new_journal(binding: String, target: Identity) -> Journal {
    Journal {
        schema: 1,
        binding,
        target,
        phase: "new".into(),
        staging: format!("PublicStaging/swift-sim-{}.ipa", uuid::Uuid::new_v4()),
        before: None,
        complete_receipt: false,
        cleanup_pending: false,
    }
}

fn valid_staging(path: &str) -> bool {
    path.strip_prefix("PublicStaging/swift-sim-")
        .and_then(|s| s.strip_suffix(".ipa"))
        .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 1 || args.get(1).is_some_and(|a| a == "--help") {
        println!(
            "Offline: swift-sim-direct-install validate PREPARED\nDevice: swift-sim-direct-install inspect|install|reconcile PREPARED PRIVATE_PEER_JSON PRIVATE_STATE_DIR --execute\nExperimental; device commands never fall back to links or start a phone runner."
        );
        return;
    }
    let started = Instant::now();
    match execute(&args).await {
        Ok(mut value) => {
            value["elapsedMs"] = json!(started.elapsed().as_millis());
            println!("{value}");
        }
        Err(code) => {
            println!(
                "{}",
                json!({"ok":false,"state":code,"elapsedMs":started.elapsed().as_millis()})
            );
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tailnet_only_no_dns_or_lan_fallback() {
        for ip in ["100.64.0.1", "100.127.255.254", "fd7a:115c:a1e0::1"] {
            assert!(tailnet(ip.parse().unwrap()));
        }
        for ip in [
            "127.0.0.1",
            "192.168.1.2",
            "100.63.255.255",
            "100.128.0.1",
            "::1",
            "fd7a:115c:a1e1::1",
        ] {
            assert!(!tailnet(ip.parse().unwrap()));
        }
    }
    #[test]
    fn cleanup_is_one_owned_file() {
        assert!(valid_staging(&format!(
            "PublicStaging/swift-sim-{}.ipa",
            uuid::Uuid::new_v4()
        )));
        for path in [
            "PublicStaging",
            "PublicStaging/../other",
            "PublicStaging/swift-sim-*.ipa",
            "/PublicStaging/swift-sim-x.ipa",
        ] {
            assert!(!valid_staging(path));
        }
    }

    #[test]
    fn durable_journal_and_per_target_lock_survive_reopen() {
        let directory =
            std::env::temp_dir().join(format!("swift-sim-install-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.join("journal.json");
        let mut journal = new_journal(
            "fixture".into(),
            Identity {
                bundle: "example.Test".into(),
                build: "2".into(),
                version: "1.0".into(),
            },
        );
        journal.phase = "submitted".into();
        journal.cleanup_pending = true;
        save(&path, &journal).unwrap();
        let recovered: Journal = read_json(&path).unwrap();
        assert_eq!(recovered.phase, "submitted");
        assert!(recovered.cleanup_pending);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let lock_path = directory.join("target.lock");
        let first = File::create(&lock_path).unwrap();
        first.try_lock_exclusive().unwrap();
        let second = File::open(&lock_path).unwrap();
        assert!(second.try_lock_exclusive().is_err());
        drop(first);
        second.try_lock_exclusive().unwrap();
        drop(second);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        fs::remove_dir_all(directory).unwrap();
    }
}
