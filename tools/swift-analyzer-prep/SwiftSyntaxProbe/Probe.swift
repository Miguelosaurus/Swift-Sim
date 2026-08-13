import Foundation
import SwiftParser
import SwiftSyntax

let input = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
let tree = Parser.parse(source: input)
let result: [String: Any] = [
    "parser": "SwiftParser",
    "hasError": tree.hasError,
    "bytes": input.utf8.count,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([0x0A]))
