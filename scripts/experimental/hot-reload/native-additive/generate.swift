// Explicit experimental generator. No production imports, transport or loading.
import Foundation
import SwiftParser
import SwiftSyntax

struct Input: Decodable {
    struct File: Decodable { let path: String; let before: String; let after: String }
    let module: String
    let generation: String
    let availableModules: [String]
    let files: [File]
}
struct Rejection: Error, CustomStringConvertible { let description: String }
func reject(_ message: String) throws -> Never { throw Rejection(description: message) }
func tokens(_ node: some SyntaxProtocol) -> String { node.tokens(viewMode: .sourceAccurate).map(\.text).joined(separator: " ") }
func clean(_ modifiers: DeclModifierListSyntax) -> DeclModifierListSyntax {
    modifiers.filter { !["public", "open", "internal", "private", "fileprivate", "package", "dynamic", "override", "final"].contains($0.name.text) }
}
func isPrivate(_ modifiers: DeclModifierListSyntax) -> Bool {
    modifiers.contains { ["private", "fileprivate"].contains($0.name.text) }
}
func nominalName(_ node: DeclSyntax) -> String? {
    if let n = node.as(StructDeclSyntax.self) { return n.name.text }
    if let n = node.as(ClassDeclSyntax.self) { return n.name.text }
    if let n = node.as(EnumDeclSyntax.self) { return n.name.text }
    if let n = node.as(ActorDeclSyntax.self) { return n.name.text }
    if let n = node.as(ProtocolDeclSyntax.self) { return n.name.text }
    return nil
}
func nominalMembers(_ node: DeclSyntax) -> MemberBlockItemListSyntax? {
    if let n = node.as(StructDeclSyntax.self) { return n.memberBlock.members }
    if let n = node.as(ClassDeclSyntax.self) { return n.memberBlock.members }
    if let n = node.as(EnumDeclSyntax.self) { return n.memberBlock.members }
    if let n = node.as(ActorDeclSyntax.self) { return n.memberBlock.members }
    if let n = node.as(ProtocolDeclSyntax.self) { return n.memberBlock.members }
    return nil
}
func nominalModifiers(_ node: DeclSyntax) -> DeclModifierListSyntax? {
    if let n = node.as(StructDeclSyntax.self) { return n.modifiers }
    if let n = node.as(ClassDeclSyntax.self) { return n.modifiers }
    if let n = node.as(EnumDeclSyntax.self) { return n.modifiers }
    if let n = node.as(ActorDeclSyntax.self) { return n.modifiers }
    if let n = node.as(ProtocolDeclSyntax.self) { return n.modifiers }
    return nil
}
func header(_ node: DeclSyntax) -> String {
    if var n = node.as(StructDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(ClassDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(EnumDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(ActorDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(ProtocolDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(ExtensionDeclSyntax.self) { n.memberBlock.members = []; return tokens(n) }
    if var n = node.as(FunctionDeclSyntax.self) { n.body = nil; return tokens(n) }
    return tokens(node)
}
func key(_ node: DeclSyntax) -> String {
    if let name = nominalName(node) { return "nominal:" + name }
    if let n = node.as(ExtensionDeclSyntax.self) { return "extension:" + header(DeclSyntax(n)) }
    if node.is(FunctionDeclSyntax.self) { return "function:" + header(node) }
    if let n = node.as(ImportDeclSyntax.self) { return "import:" + tokens(n) }
    if let n = node.as(TypeAliasDeclSyntax.self) { return "typealias:" + n.name.text }
    return "opaque:" + tokens(node)
}
final class UnsafeAddition: SyntaxVisitor {
    var found = false
    init() { super.init(viewMode: .sourceAccurate) }
    override func visit(_ n: MacroDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: IfConfigDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: AttributeSyntax) -> SyntaxVisitorContinueKind {
        let name = n.attributeName.trimmedDescription
        if !["available", "MainActor", "Sendable", "escaping", "autoclosure"].contains(name) { found = true }
        return .visitChildren
    }
}
final class LocalNominal: SyntaxVisitor {
    var found = false
    init() { super.init(viewMode: .sourceAccurate) }
    override func visit(_ n: StructDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: ClassDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: EnumDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ n: ActorDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
}
final class Generator {
    let input: Input
    var changed: [[String: String]] = []
    var added: [[String: String]] = []
    var serial = 0
    init(_ input: Input) { self.input = input }
    func emit(_ declaration: String, owner: String) -> String {
        owner.isEmpty ? declaration : "extension \(owner) {\n\(declaration)\n}"
    }
    func declarations(_ tree: SourceFileSyntax) throws -> [DeclSyntax] {
        try tree.statements.map {
            guard let declaration = $0.item.as(DeclSyntax.self) else { try reject("top-level execution is outside additive capability") }
            return declaration
        }
    }
    func compare(_ old: [DeclSyntax], _ new: [DeclSyntax], file: String, owner: String = "") throws -> [String] {
        var previous: [String: DeclSyntax] = [:]
        var current: [String: DeclSyntax] = [:]
        for declaration in old {
            guard previous.updateValue(declaration, forKey: key(declaration)) == nil else { try reject("ambiguous existing declaration in \(file)") }
        }
        for declaration in new {
            guard current.updateValue(declaration, forKey: key(declaration)) == nil else { try reject("ambiguous current declaration in \(file)") }
        }
        guard Set(previous.keys).isSubset(of: Set(current.keys)) else { try reject("existing declaration/layout/signature removed or changed in \(file)") }
        guard new.filter({ previous[key($0)] != nil }).map(key) == old.map(key) else { try reject("existing declaration order/layout changed in \(file)") }
        let newNames = Set(new.filter { previous[key($0)] == nil }.compactMap(nominalName))
        var result: [String] = []
        for declaration in new {
            let id = key(declaration)
            if let before = previous[id] {
                if tokens(before) == tokens(declaration) { continue }
                if let name = nominalName(declaration), let beforeMembers = nominalMembers(before), let afterMembers = nominalMembers(declaration) {
                    guard header(before) == header(declaration), !declaration.is(ProtocolDeclSyntax.self) else { try reject("existing nominal header or protocol changed in \(file)") }
                    let nestedOwner = owner.isEmpty ? name : owner + "." + name
                    result += try compare(beforeMembers.map(\.decl), afterMembers.map(\.decl), file: file, owner: nestedOwner)
                } else if let beforeExtension = before.as(ExtensionDeclSyntax.self), let afterExtension = declaration.as(ExtensionDeclSyntax.self) {
                    guard owner.isEmpty, beforeExtension.genericWhereClause == nil, afterExtension.attributes.isEmpty,
                          afterExtension.modifiers.isEmpty else { try reject("constrained/attributed extension needs separate qualification") }
                    result += try compare(beforeExtension.memberBlock.members.map(\.decl), afterExtension.memberBlock.members.map(\.decl), file: file, owner: afterExtension.extendedType.trimmedDescription)
                } else if let function = declaration.as(FunctionDeclSyntax.self), let body = function.body {
                    guard header(before) == header(declaration) else { try reject("existing function signature changed in \(file)") }
                    let locals = LocalNominal(); locals.walk(body)
                    guard !locals.found else { try reject("local nominal metadata needs separate qualification") }
                    let forbidden = UnsafeAddition(); forbidden.walk(function)
                    guard !forbidden.found else { try reject("macro/conditional/attribute edit needs separate qualification") }
                    var replacement = function
                    replacement.modifiers = clean(function.modifiers)
                    replacement.name = .identifier("__swiftSim_additive_\(serial)")
                    serial += 1
                    let labels = function.signature.parameterClause.parameters.map { $0.firstName.text + ":" }.joined()
                    let target = function.name.text + "(" + labels + ")"
                    result.append(emit("@_dynamicReplacement(for: \(target))\n" + replacement.trimmedDescription, owner: owner))
                    changed.append(["file": file, "owner": owner, "member": target])
                } else { try reject("unsupported changed implementation in \(file)") }
            } else {
                let forbidden = UnsafeAddition(); forbidden.walk(declaration)
                guard !forbidden.found else { try reject("added macro/conditional/attribute needs separate qualification") }
                if let imported = declaration.as(ImportDeclSyntax.self) {
                    guard owner.isEmpty, imported.attributes.isEmpty, imported.importKindSpecifier == nil,
                          imported.path.count == 1, let name = imported.path.first?.name.text,
                          input.availableModules.contains(name) else { try reject("added module not in captured available-module set") }
                    // Imports are emitted once in the per-file prelude.
                } else if let function = declaration.as(FunctionDeclSyntax.self) {
                    guard isPrivate(function.modifiers), function.body != nil else { try reject("added helper must be private/fileprivate with a body") }
                    result.append(emit(function.trimmedDescription, owner: owner))
                } else if nominalName(declaration) != nil {
                    guard owner.isEmpty, let modifiers = nominalModifiers(declaration), isPrivate(modifiers) else { try reject("added nominal must be top-level private/fileprivate") }
                    result.append(declaration.trimmedDescription)
                } else if let typealiasDecl = declaration.as(TypeAliasDeclSyntax.self) {
                    guard owner.isEmpty, isPrivate(typealiasDecl.modifiers) else { try reject("added typealias must be top-level private/fileprivate") }
                    result.append(declaration.trimmedDescription)
                } else if let extensionDecl = declaration.as(ExtensionDeclSyntax.self) {
                    guard owner.isEmpty, newNames.contains(extensionDecl.extendedType.trimmedDescription) else { try reject("new extension must target a newly added patch-local nominal in the same file") }
                    result.append(declaration.trimmedDescription)
                } else { try reject("unrepresented added declaration in \(file)") }
                added.append(["file": file, "owner": owner, "declaration": id])
            }
        }
        return result
    }
    func run() throws -> [String: Any] {
        guard input.module.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil,
              input.generation.range(of: "^[A-Za-z0-9_]{1,64}$", options: .regularExpression) != nil,
              !input.files.isEmpty, input.files.count <= 32, input.availableModules.count <= 128 else { try reject("invalid bounded input") }
        let filenames = input.files.map { URL(fileURLWithPath: $0.path).lastPathComponent }
        guard Set(filenames).count == filenames.count, filenames.allSatisfy({ $0.hasSuffix(".swift") }) else { try reject("duplicate/invalid source filenames") }
        var sources: [[String: String]] = []
        for (index, file) in input.files.enumerated() {
            let before = Parser.parse(source: file.before), after = Parser.parse(source: file.after)
            guard !before.hasError, !after.hasError else { try reject("malformed Swift input") }
            let oldDeclarations = try declarations(before), newDeclarations = try declarations(after)
            let generated = try compare(oldDeclarations, newDeclarations, file: filenames[index])
            let encoded = String(data: try JSONEncoder().encode(filenames[index]), encoding: .utf8)!
            let imports = newDeclarations.compactMap { $0.as(ImportDeclSyntax.self)?.trimmedDescription }
            let source = (["@_private(sourceFile: \(encoded)) import \(input.module)"] + imports + generated).joined(separator: "\n")
            sources.append(["path": filenames[index], "source": source])
        }
        guard !changed.isEmpty else { try reject("no changed existing callable consumes the additive bundle") }
        return ["schemaVersion": 1, "capability": "experimental-additive-v1", "stableEligible": false,
                "patchModule": "SwiftSimAdditive_" + input.generation, "changedMemberCount": changed.count,
                "addedDeclarationCount": added.count, "members": changed, "additions": added, "sources": sources,
                "requiresSeparateSourceFiles": true, "disableAccessControl": false]
    }
}
do {
    guard CommandLine.arguments.dropFirst() == ["--experimental-additive-v1"] else { try reject("explicit --experimental-additive-v1 gate required") }
    let limit = 8 * 1024 * 1024
    var data = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: min(65536, limit + 1 - data.count)), !chunk.isEmpty {
        data.append(chunk)
        guard data.count <= limit else { try reject("input exceeds 8 MiB") }
    }
    let output = try Generator(JSONDecoder().decode(Input.self, from: data)).run()
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]))
    print()
} catch {
    FileHandle.standardError.write(Data("experimental additive generator rejected: \(error)\n".utf8)); exit(1)
}
