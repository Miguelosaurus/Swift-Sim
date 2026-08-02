import qrcode from "qrcode-terminal";

export function printQRCode(value) {
  qrcode.generate(value, { small: true }, (code) => process.stdout.write(`${code}\n`));
}
