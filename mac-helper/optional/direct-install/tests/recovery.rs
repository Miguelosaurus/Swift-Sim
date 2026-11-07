use swift_sim_direct_install::{Device, Identity, Journal, Result, run};

fn identity(build: &str) -> Identity {
    Identity {
        bundle: "example.Test".into(),
        build: build.into(),
        version: "1.0".into(),
    }
}
fn journal() -> Journal {
    Journal {
        schema: 1,
        binding: "test-only".into(),
        target: identity("2"),
        phase: "new".into(),
        staging: "PublicStaging/test-only.ipa".into(),
        before: None,
        complete_receipt: false,
        cleanup_pending: false,
    }
}
struct Fake {
    installed: Option<Identity>,
    calls: Vec<&'static str>,
    drop_ack: bool,
    fail_upload: bool,
    fail_cleanup: bool,
    wrong_version: bool,
    inventory_offline: bool,
    staging_gone: bool,
}
impl Fake {
    fn new() -> Self {
        Self {
            installed: Some(identity("1")),
            calls: vec![],
            drop_ack: false,
            fail_upload: false,
            fail_cleanup: false,
            wrong_version: false,
            inventory_offline: false,
            staging_gone: false,
        }
    }
}
impl Device for Fake {
    async fn lookup(&mut self, bundle: &str) -> Result<Option<Identity>> {
        assert_eq!(bundle, "example.Test");
        self.calls.push("lookup");
        if self.inventory_offline {
            return Err("inventory_unavailable");
        }
        Ok(self.installed.clone())
    }
    async fn upload(&mut self, _: &str) -> Result<()> {
        self.calls.push("upload");
        if self.fail_upload {
            Err("upload_failed")
        } else {
            Ok(())
        }
    }
    async fn install(&mut self, _: &str, _: &str) -> Result<()> {
        self.calls.push("install");
        if !self.wrong_version {
            self.installed = Some(identity("2"));
        }
        if self.drop_ack {
            Err("disconnected")
        } else {
            Ok(())
        }
    }
    async fn remove(&mut self, _: &str) -> Result<()> {
        self.calls.push("remove");
        if self.fail_cleanup {
            Err("offline")
        } else {
            Ok(())
        }
    }
    async fn staging_absent(&mut self, _: &str) -> Result<bool> {
        self.calls.push("staging_absent");
        Ok(self.staging_gone)
    }
}

#[tokio::test]
async fn receipt_and_scoped_inventory_required() {
    let mut j = journal();
    let mut d = Fake::new();
    let mut phases = vec![];
    assert_eq!(
        run(&mut j, &mut d, false, |j| {
            phases.push(j.phase.clone());
            Ok(())
        })
        .await
        .unwrap(),
        "installed"
    );
    assert_eq!(d.calls, ["lookup", "upload", "install", "lookup", "remove"]);
    assert_eq!(
        phases,
        [
            "uploading",
            "submitted",
            "submitted",
            "verified",
            "verified"
        ]
    );
    assert!(!j.cleanup_pending);
    d.calls.clear();
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap(),
        "installed"
    );
    assert_eq!(d.calls, ["lookup"]);
}

#[tokio::test]
async fn lost_ack_survives_process_restart_and_never_reinstalls() {
    let mut j = journal();
    let mut d = Fake::new();
    d.drop_ack = true;
    let mut disk = String::new();
    assert_eq!(
        run(&mut j, &mut d, false, |j| {
            disk = serde_json::to_string(j).unwrap();
            Ok(())
        })
        .await
        .unwrap_err(),
        "install_unconfirmed_no_retry"
    );
    assert_eq!(d.calls, ["lookup", "upload", "install"]);
    let mut restarted: Journal = serde_json::from_str(&disk).unwrap();
    assert_eq!(restarted.phase, "submitted");
    d.calls.clear();
    assert_eq!(
        run(&mut restarted, &mut d, true, |_| Ok(())).await.unwrap(),
        "installed-version-observed"
    );
    assert_eq!(d.calls, ["lookup", "staging_absent"]);
    assert!(restarted.cleanup_pending);
    // Apple removing the package is sufficient; never send Remove without Complete.
    d.staging_gone = true;
    d.calls.clear();
    run(&mut restarted, &mut d, true, |_| Ok(())).await.unwrap();
    assert_eq!(d.calls, ["lookup", "staging_absent"]);
    assert!(!restarted.cleanup_pending);
}

#[tokio::test]
async fn unconfirmed_version_is_fenced_even_with_install_action() {
    let mut j = journal();
    j.phase = "submitted".into();
    j.cleanup_pending = true;
    let mut d = Fake::new();
    for reconcile in [true, false, false] {
        assert_eq!(
            run(&mut j, &mut d, reconcile, |_| Ok(()))
                .await
                .unwrap_err(),
            "install_unconfirmed_no_retry"
        );
    }
    assert_eq!(d.calls, ["lookup", "lookup", "lookup"]);
    assert!(j.cleanup_pending); // May still be consumed by Apple's installer.
}

#[tokio::test]
async fn failed_durable_fence_prevents_install_send() {
    let mut j = journal();
    let mut d = Fake::new();
    assert_eq!(
        run(&mut j, &mut d, false, |j| if j.phase == "submitted" {
            Err("disk_full")
        } else {
            Ok(())
        })
        .await
        .unwrap_err(),
        "disk_full"
    );
    assert_eq!(d.calls, ["lookup", "upload"]);
}

#[tokio::test]
async fn complete_without_expected_inventory_is_not_success() {
    let mut j = journal();
    let mut d = Fake::new();
    d.wrong_version = true;
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap_err(),
        "installed_version_mismatch"
    );
    assert_eq!(j.phase, "submitted");
    assert!(j.complete_receipt);
}

#[tokio::test]
async fn pre_submission_cleanup_and_retry_require_reconciliation() {
    let mut j = journal();
    let mut d = Fake::new();
    d.fail_upload = true;
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap_err(),
        "upload_failed_not_submitted"
    );
    assert!(!d.calls.contains(&"install"));
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap_err(),
        "reconcile_required"
    );
    assert_eq!(
        run(&mut j, &mut d, true, |_| Ok(())).await.unwrap(),
        "not-submitted"
    );
    d.fail_upload = false;
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap(),
        "installed"
    );
}

#[tokio::test]
async fn already_matching_version_does_not_mutate() {
    let mut j = journal();
    let mut d = Fake::new();
    d.installed = Some(identity("2"));
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap(),
        "already-matching-version"
    );
    assert_eq!(d.calls, ["lookup"]);
    assert!(!j.complete_receipt);
}

#[tokio::test]
async fn cleanup_failure_retains_ownership_and_retries_only_cleanup() {
    let mut j = journal();
    let mut d = Fake::new();
    d.fail_cleanup = true;
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap(),
        "installed"
    );
    assert!(j.cleanup_pending);
    d.fail_cleanup = false;
    d.calls.clear();
    run(&mut j, &mut d, true, |_| Ok(())).await.unwrap();
    assert_eq!(d.calls, ["lookup", "remove"]);
    assert!(!j.cleanup_pending);
}

#[tokio::test]
async fn unavailable_locked_or_rebooted_service_never_starts_upload() {
    let mut j = journal();
    let mut d = Fake::new();
    d.inventory_offline = true;
    assert_eq!(
        run(&mut j, &mut d, false, |_| Ok(())).await.unwrap_err(),
        "inventory_unavailable"
    );
    assert_eq!(d.calls, ["lookup"]);
    assert_eq!(j.phase, "new");
}
