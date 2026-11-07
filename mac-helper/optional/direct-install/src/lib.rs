//! Opt-in installer state machine. No discovery, retry timer, app launch, or uninstall.
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub bundle: String,
    pub build: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    pub schema: u8,
    pub binding: String,
    pub target: Identity,
    pub phase: String,
    pub staging: String,
    pub before: Option<Identity>,
    pub complete_receipt: bool,
    pub cleanup_pending: bool,
}

#[allow(async_fn_in_trait)]
pub trait Device {
    async fn lookup(&mut self, bundle: &str) -> Result<Option<Identity>>;
    async fn upload(&mut self, staging: &str) -> Result<()>;
    async fn install(&mut self, staging: &str, bundle: &str) -> Result<()>;
    async fn remove(&mut self, staging: &str) -> Result<()>;
    async fn staging_absent(&mut self, staging: &str) -> Result<bool>;
}

pub async fn run(
    journal: &mut Journal,
    device: &mut impl Device,
    reconcile_only: bool,
    mut save: impl FnMut(&Journal) -> Result<()>,
) -> Result<&'static str> {
    let observed = device.lookup(&journal.target.bundle).await?;
    if observed.as_ref() == Some(&journal.target) {
        let outcome = if journal.complete_receipt {
            "installed"
        } else if journal.phase == "submitted" && journal.before.as_ref() != Some(&journal.target) {
            // Inventory proves this version is present, not an exact installed binary hash.
            "installed-version-observed"
        } else {
            "already-matching-version"
        };
        journal.phase = "verified".into();
        save(journal)?;
        cleanup(journal, device, &mut save).await?;
        return Ok(outcome);
    }
    if journal.phase == "submitted" || journal.phase == "verified" {
        return Err("install_unconfirmed_no_retry");
    }
    if reconcile_only {
        cleanup(journal, device, &mut save).await?;
        journal.phase = "not-submitted".into();
        save(journal)?;
        return Ok("not-submitted");
    }
    if journal.phase != "new" && (journal.phase != "not-submitted" || journal.cleanup_pending) {
        return Err("reconcile_required");
    }
    journal.before = observed;
    journal.phase = "uploading".into();
    journal.cleanup_pending = true;
    save(journal)?;
    if device.upload(&journal.staging).await.is_err() {
        // No installation request has been sent. Leave durable cleanup ownership.
        cleanup(journal, device, &mut save).await?;
        return Err("upload_failed_not_submitted");
    }
    // Fsync the ambiguity fence BEFORE the first potentially mutating install byte.
    journal.phase = "submitted".into();
    save(journal)?;
    if device
        .install(&journal.staging, &journal.target.bundle)
        .await
        .is_err()
    {
        return Err("install_unconfirmed_no_retry");
    }
    journal.complete_receipt = true;
    save(journal)?;
    if device.lookup(&journal.target.bundle).await?.as_ref() != Some(&journal.target) {
        return Err("installed_version_mismatch");
    }
    journal.phase = "verified".into();
    save(journal)?;
    cleanup(journal, device, &mut save).await?;
    Ok("installed")
}

async fn cleanup(
    journal: &mut Journal,
    device: &mut impl Device,
    save: &mut impl FnMut(&Journal) -> Result<()>,
) -> Result<()> {
    if !journal.cleanup_pending {
        return Ok(());
    }
    // Inventory can become visible before an uncertain installer stops consuming
    // its IPA. Without Complete, only observe absence; do not remove that input.
    let cleaned = if journal.complete_receipt
        || ["new", "uploading", "not-submitted"].contains(&journal.phase.as_str())
    {
        device.remove(&journal.staging).await.is_ok()
    } else {
        device
            .staging_absent(&journal.staging)
            .await
            .unwrap_or(false)
    };
    if cleaned {
        journal.cleanup_pending = false;
        save(journal)?;
    }
    Ok(())
}
