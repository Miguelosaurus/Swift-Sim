// Experimental, host-toolchain-coupled generator. Never imported by the helper.
import Foundation
import SwiftParser
import SwiftSyntax

struct Input: Decodable {
    struct File: Decodable { let path: String; let before: String; let after: String }
    let module: String
    let files: [File]
}
struct Member {
    let key: String
    let owner: String
    let contextAttributes: String
    let declaration: String
    let body: String
    let lower: Int
    let upper: Int
    let line: Int
    let target: String
    let replacement: String
}
struct Failure: Error, CustomStringConvertible { let description: String }
func tokens(_ node: some SyntaxProtocol) -> String {
    node.tokens(viewMode: .sourceAccurate).map(\.text).joined(separator: " ")
}
func clean(_ modifiers: DeclModifierListSyntax) -> DeclModifierListSyntax {
    modifiers.filter {
        !["public", "open", "internal", "private", "fileprivate", "package", "dynamic", "override", "final"].contains($0.name.text)
    }
}
func accessorSurface(_ body: AccessorBlockSyntax) -> String {
    switch body.accessors {
    case .getter: return "implicit-get"
    case .accessors(let accessors):
        return accessors.map { accessor in
            var header = accessor; header.body = nil
            return tokens(header)
        }.joined(separator: " ; ")
    @unknown default: return "unknown-accessor-shape"
    }
}
final class Inventory: SyntaxVisitor {
    var owners: [String] = []
    var constraints: [String] = []
    var extensionAttributes: [String] = []
    var members: [Member] = []
    var errors: [String] = []
    let source: String
    let fileIndex: Int
    init(_ source: String, fileIndex: Int) { self.source = source; self.fileIndex = fileIndex; super.init(viewMode: .sourceAccurate) }
    func push(_ name: String) { owners.append(name) }
    override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind { push(node.name.text); return .visitChildren }
    override func visitPost(_ node: StructDeclSyntax) { owners.removeLast() }
    override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind { push(node.name.text); return .visitChildren }
    override func visitPost(_ node: ClassDeclSyntax) { owners.removeLast() }
    override func visit(_ node: ActorDeclSyntax) -> SyntaxVisitorContinueKind { push(node.name.text); return .visitChildren }
    override func visitPost(_ node: ActorDeclSyntax) { owners.removeLast() }
    override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind { push(node.name.text); return .visitChildren }
    override func visitPost(_ node: EnumDeclSyntax) { owners.removeLast() }
    override func visit(_ node: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
    override func visit(_ node: ExtensionDeclSyntax) -> SyntaxVisitorContinueKind {
        push(node.extendedType.trimmedDescription)
        constraints.append(node.genericWhereClause?.trimmedDescription ?? "")
        extensionAttributes.append(node.attributes.trimmedDescription + "\n" + clean(node.modifiers).trimmedDescription)
        return .visitChildren
    }
    override func visitPost(_ node: ExtensionDeclSyntax) { owners.removeLast(); constraints.removeLast(); extensionAttributes.removeLast() }
    override func visit(_ node: IfConfigDeclSyntax) -> SyntaxVisitorContinueKind {
        // Active compiler configuration needs explicit capture before this is usable.
        errors.append("conditional compilation needs active-configuration capture")
        return .skipChildren
    }
    func append(node: some SyntaxProtocol, body: some SyntaxProtocol, target: String, signature: String, replacement: String) {
        let owner = owners.joined(separator: ".")
        let constraint = constraints.filter { !$0.isEmpty }.joined(separator: " ")
        let extensionTarget = [owner, constraint].filter { !$0.isEmpty }.joined(separator: " ")
        let offset = node.positionAfterSkippingLeadingTrivia.utf8Offset
        let line = source.utf8.prefix(offset).filter { $0 == 10 }.count + 1
        members.append(Member(key: owner + "#" + signature, owner: extensionTarget,
            contextAttributes: extensionAttributes.joined(separator: "\n"),
            declaration: signature, body: tokens(body), lower: body.position.utf8Offset,
            upper: body.endPosition.utf8Offset, line: line, target: target, replacement: replacement))
    }
    override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
        guard let body = node.body else { return .skipChildren }
        var declaration = node
        declaration.body = nil
        var replacement = node
        replacement.modifiers = clean(node.modifiers)
        replacement.name = .identifier("__swiftSim_full_f\(fileIndex)_\(members.count)")
        let labels = node.signature.parameterClause.parameters.map { $0.firstName.text + ":" }.joined()
        append(node: node, body: body, target: node.name.text + "(" + labels + ")",
               signature: tokens(declaration), replacement: replacement.trimmedDescription)
        return .skipChildren
    }
    override func visit(_ node: InitializerDeclSyntax) -> SyntaxVisitorContinueKind {
        // Constructors have distinct allocation/delegation semantics; no guessed rewrite.
        if node.body != nil { errors.append("initializers require separate allocation/delegation qualification") }
        return .skipChildren
    }
    override func visit(_ node: DeinitializerDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
    override func visit(_ node: SubscriptDeclSyntax) -> SyntaxVisitorContinueKind {
        guard let body = node.accessorBlock else { return .skipChildren }
        var declaration = node; declaration.accessorBlock = nil
        var replacement = node; replacement.modifiers = clean(node.modifiers)
        // Same-signature replacement subscripts compile without a TX record.
        // Distinct external labels make this a real replacement declaration;
        // preserve each original internal name and target its effective label.
        let labels = node.parameterClause.parameters.map { $0.secondName == nil ? "_:" : $0.firstName.text + ":" }.joined()
        replacement.parameterClause.parameters = FunctionParameterListSyntax(node.parameterClause.parameters.enumerated().map { index, parameter in
            var renamed = parameter
            renamed.secondName = .identifier(parameter.secondName?.text ?? parameter.firstName.text)
            renamed.firstName = .identifier("__swiftSim_label_f\(fileIndex)_\(members.count)_\(index)", trailingTrivia: .space)
            return renamed
        })
        append(node: node, body: body, target: "subscript(" + labels + ")",
               signature: tokens(declaration) + " accessor-shape " + accessorSurface(body), replacement: replacement.trimmedDescription)
        return .skipChildren
    }
    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        guard node.bindings.count == 1, let binding = node.bindings.first,
              binding.initializer == nil, let body = binding.accessorBlock,
              let pattern = binding.pattern.as(IdentifierPatternSyntax.self) else { return .skipChildren }
        if case .accessors(let accessors) = body.accessors,
           accessors.contains(where: { ["willSet", "didSet"].contains($0.accessorSpecifier.text) }) { return .skipChildren }
        var declaration = node; var cleared = binding; cleared.accessorBlock = nil
        declaration.bindings = PatternBindingListSyntax([cleared])
        var replacement = node; replacement.modifiers = clean(node.modifiers)
        var renamed = binding; renamed.pattern = PatternSyntax(IdentifierPatternSyntax(identifier: .identifier("__swiftSim_full_f\(fileIndex)_\(members.count)")))
        replacement.bindings = PatternBindingListSyntax([renamed])
        append(node: node, body: body, target: pattern.identifier.text,
               signature: tokens(declaration) + " accessor-shape " + accessorSurface(body), replacement: replacement.trimmedDescription)
        return .skipChildren
    }
}

func surface(_ tree: SourceFileSyntax, inventory: Inventory) -> String {
    // Compare all tokens outside complete replaceable bodies. No partial member omission.
    tree.tokens(viewMode: .sourceAccurate).filter { token in
        !inventory.members.contains { token.position.utf8Offset >= $0.lower && token.endPosition.utf8Offset <= $0.upper }
    }.map(\.text).joined(separator: " ")
}
func generate(_ input: Input) throws -> [String: Any] {
    guard input.module.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil,
          !input.files.isEmpty, input.files.count <= 32 else { throw Failure(description: "invalid bounded input") }
    var generated: [String] = []
    var coverage: [[String: Any]] = []
    for (fileIndex, file) in input.files.enumerated() {
        let before = Parser.parse(source: file.before), after = Parser.parse(source: file.after)
        guard !before.hasError, !after.hasError else { throw Failure(description: "parse error in file \(fileIndex)") }
        let old = Inventory(file.before, fileIndex: fileIndex), new = Inventory(file.after, fileIndex: fileIndex)
        old.walk(before); new.walk(after)
        // Conditional declarations stay opaque in the surface comparison. An
        // edit inside one rejects; unchanged directives do not block other members.
        guard surface(before, inventory: old) == surface(after, inventory: new) else {
            throw Failure(description: "declaration/import/storage or unsupported implementation changed in file \(fileIndex)")
        }
        guard Set(old.members.map(\.key)).count == old.members.count,
              Set(new.members.map(\.key)).count == new.members.count else { throw Failure(description: "ambiguous duplicate declaration") }
        guard Set(old.members.map(\.key)) == Set(new.members.map(\.key)) else {
            throw Failure(description: "member/signature/accessor shape changed in file \(fileIndex)")
        }
        let previous = Dictionary(uniqueKeysWithValues: old.members.map { ($0.key, $0) })
        let imports = after.statements.compactMap { $0.item.as(ImportDeclSyntax.self)?.trimmedDescription }
        let filename = URL(fileURLWithPath: file.path).lastPathComponent
        let encoded = String(data: try JSONEncoder().encode(filename), encoding: .utf8)!
        var chunks = ["@_private(sourceFile: \(encoded)) import \(input.module)"] + imports
        for member in new.members where previous[member.key]?.body != member.body {
            // Local nominal declarations need their own metadata/coexistence proof.
            let bodyTree = Parser.parse(source: member.replacement)
            let localTypes = LocalTypes(); localTypes.walk(bodyTree)
            guard !localTypes.found else { throw Failure(description: "changed body contains local nominal metadata") }
            let magic = SourceContextExpressions(); magic.walk(bodyTree)
            guard !magic.found else { throw Failure(description: "source-context expression needs explicit original-context lowering") }
            let declaration = "@_dynamicReplacement(for: \(member.target))\n\(member.replacement)"
            chunks.append(member.owner.isEmpty ? declaration : "\(member.contextAttributes)\nextension \(member.owner) {\n\(declaration)\n}")
            coverage.append(["file": filename, "line": member.line, "member": member.target, "owner": member.owner,
                             "bodyStartUTF8": member.lower, "bodyEndUTF8": member.upper])
        }
        generated.append(chunks.joined(separator: "\n"))
    }
    return ["schemaVersion": 1, "capability": "experimental-full-callable-v1", "stableEligible": false,
            "changedMemberCount": coverage.count, "members": coverage, "sources": generated]
}
final class LocalTypes: SyntaxVisitor {
    var found = false
    init() { super.init(viewMode: .sourceAccurate) }
    override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ node: ActorDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
    override func visit(_ node: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind { found = true; return .skipChildren }
}
final class SourceContextExpressions: SyntaxVisitor {
    var found = false
    init() { super.init(viewMode: .sourceAccurate) }
    override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind {
        // Renaming/moving a callable changes #function/#fileID/#line and the
        // context of arbitrary macros. Never silently change product semantics.
        if !["selector", "keyPath"].contains(node.macroName.text) { found = true }
        return .visitChildren
    }
}
do {
    guard CommandLine.arguments.dropFirst() == ["--experimental-full-callable-v1"] else {
        throw Failure(description: "explicit --experimental-full-callable-v1 gate required")
    }
    let limit = 8 * 1024 * 1024
    var data = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: min(65_536, limit + 1 - data.count)), !chunk.isEmpty {
        data.append(chunk)
        guard data.count <= limit else { throw Failure(description: "input exceeds 8 MiB") }
    }
    let result = try generate(JSONDecoder().decode(Input.self, from: data))
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]))
    print()
} catch {
    FileHandle.standardError.write(Data("experimental generator rejected: \(error)\n".utf8)); exit(1)
}
