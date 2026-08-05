// @ts-check

import { parsePairingCredential } from "../contracts/pairing.js";

/** @typedef {import("../contracts/pairing.js").PairingCredentialRecord} PairingCredentialRecord */
/** @typedef {import("../contracts/repository.js").PairingCredentialRepository} PairingCredentialRepository */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

/** @implements {PairingCredentialRepository} */
export class SqlitePairingCredentialRepository {
  #getStatement;
  #replaceStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#getStatement = database.prepare(`SELECT
      token,
      installation_id,
      mac_name,
      created_at,
      updated_at
    FROM pairing_credentials
    WHERE singleton = 1`);
    this.#replaceStatement = database.prepare(`INSERT INTO pairing_credentials(
      singleton,
      token,
      installation_id,
      mac_name,
      created_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      token = excluded.token,
      installation_id = excluded.installation_id,
      mac_name = excluded.mac_name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`);
  }

  /** @returns {PairingCredentialRecord | null} */
  get() {
    const row = this.#getStatement.get();
    return row ? mapPairingRow(row) : null;
  }

  /** @param {PairingCredentialRecord} record */
  replace(record) {
    const validated = parsePairingCredential(record);
    this.#replaceStatement.run(
      validated.token,
      validated.installationID,
      validated.macName,
      validated.createdAt,
      validated.updatedAt,
    );
  }
}

/** @param {unknown} row @returns {PairingCredentialRecord} */
function mapPairingRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid pairing credential row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  return parsePairingCredential({
    token: values.token,
    installationID: values.installation_id,
    macName: values.mac_name,
    createdAt: values.created_at,
    updatedAt: values.updated_at,
  });
}
