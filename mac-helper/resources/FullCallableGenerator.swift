// Versioned full-callable representation. Admission and native proof are separate.
import Foundation
import SwiftParser
import SwiftSyntax

struct Input: Decodable {
    struct File: Decodable { let path: String; let before: String; let after: String; let installedBaseline: String? }
    let module: String
    let generation: String
    let files: [File]
    let statefulBodies: [String: [String]]?
    let allowAdditive: Bool?
    let availableModules: [String]?
    let preserveViewFunctions: Bool?
}

struct InstrumentInput: Decodable {
    struct File: Decodable { let path: String; let source: String }
    let files: [File]
}

func statefulBody(_ statements: CodeBlockItemListSyntax, lineCount: Int) -> AccessorBlockSyntax {
    // The local builder preserves the original result-builder/explicit-return
    // semantics. AnyView fixes the installed ABI before any patch is compiled.
    let inner = statements.description
    let padding = String(repeating: "\n", count: max(0, lineCount - inner.filter { $0 == "\n" }.count))
    let text = "{ @SwiftUI.ViewBuilder func __swiftSimBuildBody() -> some SwiftUI.View {\(inner)\(padding)}; return SwiftUI.AnyView(__swiftSimBuildBody()) }"
    let tree = Parser.parse(source: "var body: SwiftUI.AnyView \(text)")
    return tree.statements.first!.item.as(VariableDeclSyntax.self)!.bindings.first!.accessorBlock!
}

final class StatefulInstrumenter: SyntaxRewriter {
    var owners: [String] = []
    var viewOwners = Set<String>()
    var wrapped: [String] = []
    override func visit(_ node: IfConfigDeclSyntax) -> DeclSyntax { DeclSyntax(node) }
    override func visit(_ node: ExtensionDeclSyntax) -> DeclSyntax { DeclSyntax(node) }
    override func visit(_ node: ClassDeclSyntax) -> DeclSyntax { DeclSyntax(node) }
    override func visit(_ node: ActorDeclSyntax) -> DeclSyntax { DeclSyntax(node) }
    override func visit(_ node: EnumDeclSyntax) -> DeclSyntax {
        guard node.genericParameterClause == nil, node.genericWhereClause == nil else { return DeclSyntax(node) }
        owners.append(node.name.text); let result = super.visit(node); owners.removeLast(); return result
    }
    override func visit(_ node: StructDeclSyntax) -> DeclSyntax {
        guard node.genericParameterClause == nil, node.genericWhereClause == nil else { return DeclSyntax(node) }
        let name = (owners + [node.name.text]).joined(separator: ".")
        let explicitView = node.inheritanceClause?.inheritedTypes.contains {
            ["View", "SwiftUI.View"].contains($0.type.trimmedDescription)
        } == true
        let safe = node.genericParameterClause == nil && node.genericWhereClause == nil
            && !node.description.contains("__swiftSimRefresh")
            && !node.modifiers.contains(where: { $0.name.text == "nonisolated" })
            && !node.memberBlock.members.contains(where: { $0.decl.is(InitializerDeclSyntax.self) && $0.decl.description.contains("nonisolated") })
        owners.append(node.name.text)
        if explicitView && safe { viewOwners.insert(name) }
        let count = wrapped.count
        var result = super.visit(node).as(StructDeclSyntax.self)!
        owners.removeLast()
        if wrapped.count > count && wrapped[count...].contains(name) {
            var field = Parser.parse(source: "@SwiftSimLive.SwiftSimRefresh private var __swiftSimRefresh")
                .statements.first!.item.as(VariableDeclSyntax.self)!
            // Use the type's existing closing line. A trailing // comment on
            // the last member must never swallow the observation property.
            field.leadingTrivia = result.memberBlock.rightBrace.leadingTrivia
            result.memberBlock.rightBrace.leadingTrivia = .space
            if let last = result.memberBlock.members.indices.last,
               !result.memberBlock.members[last].decl.is(IfConfigDeclSyntax.self) {
                result.memberBlock.members[last].semicolon = .semicolonToken()
            }
            result.memberBlock.members.append(MemberBlockItemSyntax(decl: DeclSyntax(field)))
        }
        return DeclSyntax(result)
    }
    override func visit(_ node: VariableDeclSyntax) -> DeclSyntax {
        let owner = owners.joined(separator: ".")
        guard viewOwners.contains(owner), node.bindings.count == 1,
              let binding = node.bindings.first,
              binding.pattern.as(IdentifierPatternSyntax.self)?.identifier.text == "body",
              let type = binding.typeAnnotation?.type,
              ["someView", "someSwiftUI.View", "AnyView", "SwiftUI.AnyView"].contains(tokens(type).replacingOccurrences(of: " ", with: "")),
              let block = binding.accessorBlock,
              case .getter(let statements) = block.accessors else { return DeclSyntax(node) }
        let context = SourceContextExpressions(); context.walk(block)
        let locals = LocalTypes(); locals.walk(block)
        guard !context.found, !locals.found, !block.description.contains("__swiftSimBuildBody") else { return DeclSyntax(node) }
        var result = node
        var value = binding
        value.typeAnnotation = TypeAnnotationSyntax(type: TypeSyntax(IdentifierTypeSyntax(name: .identifier("SwiftUI.AnyView"))))
        value.accessorBlock = statefulBody(statements, lineCount: block.description.filter { $0 == "\n" }.count)
        result.bindings = PatternBindingListSyntax([value])
        wrapped.append(owner)
        return DeclSyntax(result)
    }
}

func instrument(_ input: InstrumentInput) throws -> [String: Any] {
    guard input.files.count <= 2048 else { throw Failure(description: "instrumentation file limit") }
    var result: [[String: Any]] = []
    for file in input.files {
        let tree = Parser.parse(source: file.source)
        guard !tree.hasError else { continue }
        let rewrite = StatefulInstrumenter()
        let output = rewrite.rewrite(tree).description
        if !rewrite.wrapped.isEmpty {
            guard output.filter({ $0 == "\n" }).count == file.source.filter({ $0 == "\n" }).count else { continue }
            let encoder = JSONEncoder(); encoder.outputFormatting = [.withoutEscapingSlashes]
            let filename = String(data: try encoder.encode(file.path), encoding: .utf8)!
            let final = "import SwiftSimLive\nimport SwiftUI\n#sourceLocation(file: \(filename), line: 1)\n" + output
            guard !Parser.parse(source: final).hasError else { continue }
            result.append(["path": file.path, "source": final, "owners": rewrite.wrapped.sorted()])
        }
    }
    return ["schemaVersion": 1, "capability": "stateful-overlay-v1", "files": result]
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
    let replacementName: String
    let kind: String
    let accessors: [String]
    let isStatic: Bool
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
func accessorRequirements(_ body: AccessorBlockSyntax) -> [String]? {
    switch body.accessors {
    case .getter: return ["getter"]
    case .accessors(let accessors):
        let names = accessors.map { $0.accessorSpecifier.text }
        guard !names.isEmpty, Set(names).count == names.count,
              names.allSatisfy({ ["get", "set"].contains($0) }) else { return nil }
        return names.map { $0 == "get" ? "getter" : "setter" }
    @unknown default: return nil
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
    let generation: String
    init(_ source: String, fileIndex: Int, generation: String) { self.source = source; self.fileIndex = fileIndex; self.generation = generation; super.init(viewMode: .sourceAccurate) }
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
    func append(node: some SyntaxProtocol, body: some SyntaxProtocol, target: String, signature: String, replacement: String,
                replacementName: String, kind: String = "function", accessors: [String] = [], isStatic: Bool = false) {
        let owner = owners.joined(separator: ".")
        let constraint = constraints.filter { !$0.isEmpty }.joined(separator: " ")
        let extensionTarget = [owner, constraint].filter { !$0.isEmpty }.joined(separator: " ")
        let offset = node.positionAfterSkippingLeadingTrivia.utf8Offset
        let line = source.utf8.prefix(offset).filter { $0 == 10 }.count + 1
        members.append(Member(key: owner + "#" + signature, owner: extensionTarget,
            contextAttributes: extensionAttributes.joined(separator: "\n"),
            declaration: signature, body: tokens(body), lower: body.position.utf8Offset,
            upper: body.endPosition.utf8Offset, line: line, target: target, replacement: replacement,
            replacementName: replacementName, kind: kind, accessors: accessors, isStatic: isStatic))
    }
    override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
        guard let body = node.body else { return .skipChildren }
        var declaration = node
        declaration.body = nil
        var replacement = node
        replacement.modifiers = clean(node.modifiers)
        replacement.name = .identifier("__swiftSim_full_g\(generation)_f\(fileIndex)_\(members.count)")
        let labels = node.signature.parameterClause.parameters.map { $0.firstName.text + ":" }.joined()
        append(node: node, body: body, target: node.name.text + "(" + labels + ")",
               signature: tokens(declaration), replacement: replacement.trimmedDescription,
               replacementName: replacement.name.text, isStatic: node.modifiers.contains { ["static", "class"].contains($0.name.text) })
        return .skipChildren
    }
    override func visit(_ node: InitializerDeclSyntax) -> SyntaxVisitorContinueKind {
        // Constructors have distinct allocation/delegation semantics; no guessed rewrite.
        if node.body != nil { errors.append("initializers require separate allocation/delegation qualification") }
        return .skipChildren
    }
    override func visit(_ node: DeinitializerDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
    override func visit(_ node: SubscriptDeclSyntax) -> SyntaxVisitorContinueKind {
        guard let body = node.accessorBlock, let requirements = accessorRequirements(body) else { return .skipChildren }
        var declaration = node; declaration.accessorBlock = nil
        var replacement = node; replacement.modifiers = clean(node.modifiers)
        // Same-signature replacement subscripts compile without a TX record.
        // Distinct external labels make this a real replacement declaration;
        // preserve each original internal name and target its effective label.
        let labels = node.parameterClause.parameters.map { $0.secondName == nil ? "_:" : $0.firstName.text + ":" }.joined()
        replacement.parameterClause.parameters = FunctionParameterListSyntax(node.parameterClause.parameters.enumerated().map { index, parameter in
            var renamed = parameter
            renamed.secondName = .identifier(parameter.secondName?.text ?? parameter.firstName.text)
            renamed.firstName = .identifier("__swiftSim_label_g\(generation)_f\(fileIndex)_\(members.count)_\(index)", trailingTrivia: .space)
            return renamed
        })
        append(node: node, body: body, target: "subscript(" + labels + ")",
               signature: tokens(declaration) + " accessor-shape " + accessorSurface(body), replacement: replacement.trimmedDescription,
               replacementName: "__swiftSim_label_g\(generation)_f\(fileIndex)_\(members.count)_0", kind: "subscript", accessors: requirements,
               isStatic: node.modifiers.contains { ["static", "class"].contains($0.name.text) })
        return .skipChildren
    }
    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        guard node.bindings.count == 1, let binding = node.bindings.first,
              binding.initializer == nil, let body = binding.accessorBlock,
              let pattern = binding.pattern.as(IdentifierPatternSyntax.self),
              let requirements = accessorRequirements(body) else { return .skipChildren }
        if case .accessors(let accessors) = body.accessors,
           accessors.contains(where: { ["willSet", "didSet"].contains($0.accessorSpecifier.text) }) { return .skipChildren }
        var declaration = node; var cleared = binding; cleared.accessorBlock = nil
        declaration.bindings = PatternBindingListSyntax([cleared])
        var replacement = node; replacement.modifiers = clean(node.modifiers)
        var renamed = binding; renamed.pattern = PatternSyntax(IdentifierPatternSyntax(identifier: .identifier("__swiftSim_full_g\(generation)_f\(fileIndex)_\(members.count)")))
        replacement.bindings = PatternBindingListSyntax([renamed])
        append(node: node, body: body, target: pattern.identifier.text,
               signature: tokens(declaration) + " accessor-shape " + accessorSurface(body), replacement: replacement.trimmedDescription,
               replacementName: "__swiftSim_full_g\(generation)_f\(fileIndex)_\(members.count)", kind: "property", accessors: requirements,
               isStatic: node.modifiers.contains { ["static", "class"].contains($0.name.text) })
        return .skipChildren
    }
}

func surface(_ tree: SourceFileSyntax, inventory: Inventory) -> String {
    // Compare all tokens outside complete replaceable bodies. No partial member omission.
    tree.tokens(viewMode: .sourceAccurate).filter { token in
        !inventory.members.contains { token.position.utf8Offset >= $0.lower && token.endPosition.utf8Offset <= $0.upper }
    }.map(\.text).joined(separator: " ")
}
// Additions are removed only for structural comparison. Their original source
// and private lexical boundaries are emitted into the corresponding patch unit.
final class AdditiveSyntaxGuard: SyntaxVisitor {
    var unsafe = false
    init() { super.init(viewMode: .sourceAccurate) }
    override func visit(_ node: MacroDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: IfConfigDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: AttributeSyntax) -> SyntaxVisitorContinueKind {
        if !["available", "MainActor", "Sendable", "escaping", "autoclosure"].contains(node.attributeName.trimmedDescription) { unsafe = true }
        return .visitChildren
    }
}
func additiveNominal(_ node: DeclSyntax) -> (String, [DeclSyntax])? {
    if let n = node.as(StructDeclSyntax.self) { return (n.name.text, n.memberBlock.members.map(\.decl)) }
    if let n = node.as(ClassDeclSyntax.self) { return (n.name.text, n.memberBlock.members.map(\.decl)) }
    if let n = node.as(EnumDeclSyntax.self) { return (n.name.text, n.memberBlock.members.map(\.decl)) }
    if let n = node.as(ActorDeclSyntax.self) { return (n.name.text, n.memberBlock.members.map(\.decl)) }
    if let n = node.as(ProtocolDeclSyntax.self) { return (n.name.text, n.memberBlock.members.map(\.decl)) }
    return nil
}
func additiveKey(_ node: DeclSyntax) -> String {
    if let (name, _) = additiveNominal(node) { return "nominal:" + name }
    if var n = node.as(FunctionDeclSyntax.self) { n.body = nil; return "function:" + tokens(n) }
    if var n = node.as(SubscriptDeclSyntax.self) { n.accessorBlock = nil; return "subscript:" + tokens(n) }
    if var n = node.as(VariableDeclSyntax.self) {
        n.bindings = PatternBindingListSyntax(n.bindings.map { binding in
            var value = binding; value.accessorBlock = nil; return value
        })
        return "variable:" + tokens(n)
    }
    if var n = node.as(ExtensionDeclSyntax.self) { n.memberBlock.members = []; return "extension:" + tokens(n) }
    if let n = node.as(ImportDeclSyntax.self) { return "import:" + tokens(n) }
    if let n = node.as(TypeAliasDeclSyntax.self) { return "typealias:" + n.name.text }
    return "opaque:" + tokens(node)
}
final class AdditiveDeclarations {
    var emitted: [String] = []
    var additions: [[String: String]] = []
    var ranges: [Range<Int>] = []
    let availableModules: Set<String>
    let file: String
    init(file: String, modules: [String]) { self.file = file; availableModules = Set(modules) }
    func privateOnly(_ modifiers: DeclModifierListSyntax) -> Bool {
        modifiers.contains { ["private", "fileprivate"].contains($0.name.text) }
    }
    func declarations(_ tree: SourceFileSyntax) throws -> [DeclSyntax] {
        try tree.statements.map {
            guard let node = $0.item.as(DeclSyntax.self) else { throw Failure(description: "top-level execution is not additive") }
            return node
        }
    }
    func compare(_ previous: [DeclSyntax], _ current: [DeclSyntax], owner: String = "") throws {
        let keys = previous.map(additiveKey), newKeys = current.map(additiveKey)
        let originalKeys = Set(keys)
        guard Set(keys).count == keys.count, Set(newKeys).count == newKeys.count,
              originalKeys.isSubset(of: Set(newKeys)), newKeys.filter({ originalKeys.contains($0) }) == keys else {
            throw Failure(description: "existing declaration order, layout or signature changed")
        }
        let old = Dictionary(uniqueKeysWithValues: zip(keys, previous))
        for node in current {
            let key = additiveKey(node)
            if let before = old[key] {
                if tokens(before) == tokens(node) { continue }
                if let (name, oldMembers) = additiveNominal(before), let (_, newMembers) = additiveNominal(node) {
                    guard !node.is(ProtocolDeclSyntax.self) else { throw Failure(description: "existing protocol changed") }
                    try compare(oldMembers, newMembers, owner: owner.isEmpty ? name : owner + "." + name)
                } else if let a = before.as(ExtensionDeclSyntax.self), let b = node.as(ExtensionDeclSyntax.self) {
                    try compare(a.memberBlock.members.map(\.decl), b.memberBlock.members.map(\.decl), owner: b.extendedType.trimmedDescription)
                }
                continue
            }
            let check = AdditiveSyntaxGuard(); check.walk(node)
            guard !check.unsafe else { throw Failure(description: "additive macros, conditional declarations or unsupported attributes") }
            if let n = node.as(ImportDeclSyntax.self) {
                guard owner.isEmpty, n.attributes.isEmpty, n.importKindSpecifier == nil, n.path.count == 1,
                      let module = n.path.first?.name.text, availableModules.contains(module) else {
                    throw Failure(description: "added import is unavailable in the captured context")
                }
            } else if let n = node.as(FunctionDeclSyntax.self) {
                guard privateOnly(n.modifiers), n.body != nil else { throw Failure(description: "added function must be private with a body") }
                emitted.append(owner.isEmpty ? n.trimmedDescription : "extension \(owner) {\n\(n.trimmedDescription)\n}")
            } else if let n = node.as(StructDeclSyntax.self), owner.isEmpty, privateOnly(n.modifiers) {
                emitted.append(n.trimmedDescription)
            } else if let n = node.as(EnumDeclSyntax.self), owner.isEmpty, privateOnly(n.modifiers) {
                emitted.append(n.trimmedDescription)
            } else if let n = node.as(TypeAliasDeclSyntax.self), owner.isEmpty, privateOnly(n.modifiers) {
                emitted.append(n.trimmedDescription)
            } else { throw Failure(description: "unsupported added declaration") }
            ranges.append(node.position.utf8Offset..<node.endPosition.utf8Offset)
            additions.append(["file": file, "owner": owner, "declaration": key])
        }
    }
    func strip(baseline: String, desired: String) throws -> String {
        let before = Parser.parse(source: baseline), after = Parser.parse(source: desired)
        guard !before.hasError, !after.hasError else { throw Failure(description: "invalid additive syntax") }
        try compare(declarations(before), declarations(after))
        var bytes = Array(desired.utf8)
        for range in ranges {
            for index in range where bytes[index] != 10 && bytes[index] != 13 { bytes[index] = 32 }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

func generate(_ input: Input) throws -> [String: Any] {
    guard input.module.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil,
          input.generation.range(of: "^[a-f0-9]{24,64}$", options: .regularExpression) != nil,
          !input.files.isEmpty, input.files.count <= 32 else { throw Failure(description: "invalid bounded input") }
    let filenames = input.files.map { URL(fileURLWithPath: $0.path).lastPathComponent }
    guard Set(filenames).count == filenames.count,
          input.files.allSatisfy({ $0.before.utf8.count <= 1024 * 1024 && $0.after.utf8.count <= 1024 * 1024 }) else {
        throw Failure(description: "ambiguous file identity or oversized source")
    }
    var generated: [String] = []
    var coverage: [[String: Any]] = []
    var additions: [[String: String]] = []
    var additiveContext = false
    for (fileIndex, file) in input.files.enumerated() {
        let baseline = input.allowAdditive == true ? (file.installedBaseline ?? file.before) : file.before
        let plan = AdditiveDeclarations(file: filenames[fileIndex], modules: input.availableModules ?? [])
        let priorPlan = AdditiveDeclarations(file: filenames[fileIndex], modules: input.availableModules ?? [])
        let desiredSource = input.allowAdditive == true ? try plan.strip(baseline: baseline, desired: file.after) : file.after
        let previousSource = input.allowAdditive == true ? try priorPlan.strip(baseline: baseline, desired: file.before) : file.before
        additions += plan.additions
        additiveContext = additiveContext || !plan.additions.isEmpty || !priorPlan.additions.isEmpty
        let before = Parser.parse(source: baseline), after = Parser.parse(source: desiredSource)
        guard !before.hasError, !after.hasError else { throw Failure(description: "parse error in file \(fileIndex)") }
        let old = Inventory(baseline, fileIndex: fileIndex, generation: input.generation), new = Inventory(desiredSource, fileIndex: fileIndex, generation: input.generation)
        old.walk(before); new.walk(after)
        let prior: Inventory
        if previousSource == baseline { prior = old }
        else {
            prior = Inventory(previousSource, fileIndex: fileIndex, generation: input.generation)
            let previousTree = Parser.parse(source: previousSource)
            prior.walk(previousTree)
            guard surface(before, inventory: old) == surface(previousTree, inventory: prior) else {
                throw Failure(description: "previous intent differs from installed structure")
            }
        }
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
        guard Set(prior.members.map(\.key)).count == prior.members.count else { throw Failure(description: "ambiguous previous callable") }
        let incremental = Dictionary(uniqueKeysWithValues: prior.members.map { ($0.key, $0) })
        let importTree = desiredSource == file.after ? after : Parser.parse(source: file.after)
        let imports = importTree.statements.compactMap { $0.item.as(ImportDeclSyntax.self)?.trimmedDescription }
        let filename = URL(fileURLWithPath: file.path).lastPathComponent
        let encoded = String(data: try JSONEncoder().encode(filename), encoding: .utf8)!
        var chunks = ["@_private(sourceFile: \(encoded)) import \(input.module)"] + imports + plan.emitted
        for member in new.members where previous[member.key]?.body != member.body || incremental[member.key]?.body != member.body {
            // Local nominal declarations need their own metadata/coexistence proof.
            let bodyTree = Parser.parse(source: member.replacement)
            let localTypes = LocalTypes(); localTypes.walk(bodyTree)
            guard !localTypes.found else { throw Failure(description: "changed body contains local nominal metadata") }
            let magic = SourceContextExpressions(); magic.walk(bodyTree)
            guard !magic.found else { throw Failure(description: "source-context expression needs explicit original-context lowering") }
            var replacement = member.replacement
            if member.target == "body", input.statefulBodies?[file.path]?.contains(member.owner) == true {
                let tree = Parser.parse(source: replacement)
                guard var property = tree.statements.first?.item.as(VariableDeclSyntax.self),
                      var binding = property.bindings.first, let block = binding.accessorBlock,
                      case .getter(let statements) = block.accessors else { throw Failure(description: "stateful body shape changed") }
                binding.typeAnnotation = TypeAnnotationSyntax(type: TypeSyntax(IdentifierTypeSyntax(name: .identifier("SwiftUI.AnyView"))))
                binding.accessorBlock = statefulBody(statements, lineCount: block.description.filter { $0 == "\n" }.count)
                property.bindings = PatternBindingListSyntax([binding])
                replacement = property.description
            }
            let declaration = "@_dynamicReplacement(for: \(member.target))\n\(replacement)"
            chunks.append(member.owner.isEmpty ? declaration : "\(member.contextAttributes)\nextension \(member.owner) {\n\(declaration)\n}")
            coverage.append(["file": filename, "line": member.line, "member": member.target, "owner": member.owner,
                             "bodyStartUTF8": member.lower, "bodyEndUTF8": member.upper,
                             "replacementName": member.replacementName, "kind": member.kind, "accessors": member.accessors,
                             "isStatic": member.isStatic])
        }
        generated.append(chunks.joined(separator: "\n"))
    }
    let preserving = !coverage.isEmpty && coverage.allSatisfy {
        guard let owner = $0["owner"] as? String,
              ($0["member"] as? String == "body" || ((input.allowAdditive == true || input.preserveViewFunctions == true) && $0["kind"] as? String == "function" && $0["isStatic"] as? Bool == false)),
              let filename = $0["file"] as? String else { return false }
        return input.files.contains { file in URL(fileURLWithPath: file.path).lastPathComponent == filename
            && input.statefulBodies?[file.path]?.contains(owner) == true }
    }
    return ["schemaVersion": 1, "capability": "full-callable-v1", "generation": input.generation, "module": input.module,
            "refreshStrategy": preserving ? "preserve-state-v1" : "remount",
            "changedMemberCount": coverage.count, "members": coverage, "sources": generated,
            "additiveProtocol": additiveContext ? 1 : 0, "additions": additions,
            "requiresPrivateScopes": additiveContext]
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
    let mode = Array(CommandLine.arguments.dropFirst())
    guard mode == ["--full-callable-generator-v1"] || mode == ["--instrument-stateful-v1"] else {
        throw Failure(description: "versioned generator invocation required")
    }
    let limit = 8 * 1024 * 1024
    var data = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: min(65_536, limit + 1 - data.count)), !chunk.isEmpty {
        data.append(chunk)
        guard data.count <= limit else { throw Failure(description: "input exceeds 8 MiB") }
    }
    let result = mode == ["--instrument-stateful-v1"]
        ? try instrument(JSONDecoder().decode(InstrumentInput.self, from: data))
        : try generate(JSONDecoder().decode(Input.self, from: data))
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]))
    print()
} catch {
    FileHandle.standardError.write(Data("full-callable generator rejected: \(error)\n".utf8)); exit(1)
}
