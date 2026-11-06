// Versioned full-callable representation. Admission and native proof are separate.
import Foundation
import CryptoKit
import SwiftParser
import SwiftSyntax

struct Input: Decodable {
    struct StatefulOrigin: Decodable { let path: String; let owner: String; let module: String; let sourceFile: String; let layoutDigest: String; let stateNames: [String]? }
    struct File: Decodable { let path: String; let before: String; let after: String; let installedBaseline: String?; let isNewFile: Bool? }
    let module: String
    let generation: String
    let files: [File]
    let statefulBodies: [String: [String]]?
    let allowAdditive: Bool?
    let availableModules: [String]?
    let preserveViewFunctions: Bool?
    let allowSharedAdditive: Bool?
    let moduleSources: [InstrumentInput.File]?
    let allowAddedState: Bool?
    let stateGeneration: UInt64?
    let allowStatefulAdditive: Bool?
    let statefulOrigins: [StatefulOrigin]?
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
    let allowStateful: Bool
    init(allowStateful: Bool = false) { self.allowStateful = allowStateful; super.init(viewMode: .sourceAccurate) }
    override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: ActorDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: MacroDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: IfConfigDeclSyntax) -> SyntaxVisitorContinueKind { unsafe = true; return .skipChildren }
    override func visit(_ node: AttributeSyntax) -> SyntaxVisitorContinueKind {
        if allowStateful && statefulWrapperNames.contains(node.attributeName.trimmedDescription) { return .visitChildren }
        if !["available", "MainActor", "Sendable", "escaping", "autoclosure"].contains(node.attributeName.trimmedDescription) { unsafe = true }
        return .visitChildren
    }
}
let statefulWrapperNames: Set<String> = ["State", "Binding", "Environment", "SwiftUI.State", "SwiftUI.Binding", "SwiftUI.Environment"]
func statefulView(_ node: DeclSyntax) -> StructDeclSyntax? {
    guard let view = node.as(StructDeclSyntax.self), view.inheritanceClause?.inheritedTypes.contains(where: {
        ["View", "SwiftUI.View"].contains($0.type.trimmedDescription)
    }) == true, view.memberBlock.members.contains(where: { member in
        member.decl.as(VariableDeclSyntax.self)?.attributes.contains(where: {
            $0.as(AttributeSyntax.self).map { statefulWrapperNames.contains($0.attributeName.trimmedDescription) } == true
        }) == true
    }) else { return nil }
    return view
}
struct StatefulComponent {
    let source: String
    let owner: String
    let layoutDigest: String
    let storageNames: Set<String>
    let bareWrappers: Set<String>
    let members: [Member]
    let origin: Input.StatefulOrigin?
    let stateNames: [String]?
    let addedStates: [AddedStateField]
}
final class ComponentDynamics: SyntaxRewriter {
    func dynamic(_ modifiers: DeclModifierListSyntax) -> DeclModifierListSyntax {
        if modifiers.contains(where: { $0.name.text == "dynamic" }) { return modifiers }
        return DeclModifierListSyntax(Array(modifiers) + [DeclModifierSyntax(name: .keyword(.dynamic), trailingTrivia: .space)])
    }
    override func visit(_ node: FunctionDeclSyntax) -> DeclSyntax {
        var result = node; result.leadingTrivia = []
        result.modifiers = dynamic(result.modifiers); result.leadingTrivia = node.leadingTrivia
        return DeclSyntax(result)
    }
    override func visit(_ node: VariableDeclSyntax) -> DeclSyntax {
        var result = node
        if node.bindings.count == 1, node.bindings.first?.accessorBlock != nil {
            result.leadingTrivia = []; result.modifiers = dynamic(result.modifiers); result.leadingTrivia = node.leadingTrivia
        }
        return DeclSyntax(result)
    }
    override func visit(_ node: SubscriptDeclSyntax) -> DeclSyntax {
        var result = node; result.leadingTrivia = []
        result.modifiers = dynamic(result.modifiers); result.leadingTrivia = node.leadingTrivia
        return DeclSyntax(result)
    }
}
func componentPlan(_ declaration: StructDeclSyntax, origin: Input.StatefulOrigin?, fileIndex: Int, generation: String,
                   allowAddedState: Bool = false, module: String = "", path: String = "") throws -> StatefulComponent {
    var node = declaration
    let initialNames = declaration.memberBlock.members.compactMap { member -> String? in
        guard let value = member.decl.as(VariableDeclSyntax.self), value.attributes.contains(where: {
            $0.as(AttributeSyntax.self).map { ["State", "SwiftUI.State"].contains($0.attributeName.trimmedDescription) } == true
        }) else { return nil }
        return value.bindings.first?.pattern.as(IdentifierPatternSyntax.self)?.identifier.text
    }.sorted()
    var addedStates: [AddedStateField] = []
    if allowAddedState, let initial = origin?.stateNames {
        node.memberBlock.members = try declaration.memberBlock.members.filter { member in
            guard let value = member.decl.as(VariableDeclSyntax.self), let name = value.bindings.first?.pattern.as(IdentifierPatternSyntax.self)?.identifier.text,
                  !initial.contains(name), value.attributes.contains(where: {
                      $0.as(AttributeSyntax.self).map { ["State", "SwiftUI.State"].contains($0.attributeName.trimmedDescription) } == true
                  }) else { return true }
            addedStates.append(try addedStateField(value, owner: node.name.text, module: module, path: path)); return false
        }
    }
    guard node.genericParameterClause == nil, node.genericWhereClause == nil,
          !node.modifiers.contains(where: { $0.name.text == "nonisolated" }),
          !node.description.contains("__swiftSim"),
          !node.memberBlock.members.contains(where: { additiveNominal($0.decl) != nil }) else { throw Failure(description: "stateful component needs a concrete, unnested view") }
    let source = node.trimmedDescription
    let tree = Parser.parse(source: source), inventory = Inventory(source, fileIndex: fileIndex, generation: generation)
    inventory.walk(tree)
    guard inventory.members.contains(where: { $0.target == "body" && $0.kind == "property" && $0.accessors == ["getter"] }),
          !inventory.members.contains(where: { $0.target != "body" && $0.declaration.range(of: "\\bsome\\b", options: .regularExpression) != nil }) else {
        throw Failure(description: "stateful component computed opaque helpers need explicit ABI qualification")
    }
    let layout = SHA256.hash(data: Data(surface(tree, inventory: inventory).utf8)).map { String(format: "%02x", $0) }.joined()
    guard origin == nil || origin?.layoutDigest == layout else { throw Failure(description: "stateful component stored layout or initializer changed; build a new Debug app for this edit") }
    var storage = Set<String>(), bare = Set<String>()
    for member in node.memberBlock.members {
        if let value = member.decl.as(VariableDeclSyntax.self) {
            for binding in value.bindings where binding.accessorBlock == nil {
                let text = (binding.typeAnnotation?.description ?? "") + (binding.initializer?.description ?? "")
                for token in Parser.parse(source: text).tokens(viewMode: .sourceAccurate) { if case .identifier = token.tokenKind { storage.insert(token.text) } }
            }
            for attr in value.attributes {
                if let attr = attr.as(AttributeSyntax.self), statefulWrapperNames.contains(attr.attributeName.trimmedDescription) {
                    if !attr.attributeName.trimmedDescription.contains(".") { bare.insert(attr.attributeName.trimmedDescription) }
                    if let arguments = attr.arguments {
                        for token in arguments.tokens(viewMode: .sourceAccurate) { if case .identifier = token.tokenKind { storage.insert(token.text) } }
                    }
                }
            }
        } else if let initializer = member.decl.as(InitializerDeclSyntax.self) {
            for token in initializer.tokens(viewMode: .sourceAccurate) { if case .identifier = token.tokenKind { storage.insert(token.text) } }
        }
    }
    let rewrite = StatefulInstrumenter(); let wrapped = rewrite.rewrite(tree)
    guard rewrite.wrapped == [node.name.text] else { throw Failure(description: "stateful component body cannot be instrumented") }
    let emitted = ComponentDynamics().rewrite(wrapped).description
    return StatefulComponent(source: emitted, owner: node.name.text, layoutDigest: layout, storageNames: storage,
                             bareWrappers: bare, members: inventory.members, origin: origin,
                             stateNames: origin?.stateNames ?? (initialNames.count <= 32 ? initialNames : nil), addedStates: addedStates)
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
// New State is lowered to the installed refresh slot, never new instance storage.
struct AddedStateField {
    let owner: String; let name: String; let type: String; let initial: String
    let key: String; let modifiers: String; let attributes: String; let shadowNames: Set<String>
    let wrapper: String; let sourceType: String
    var bindingName: String { "__swiftSimAddedBinding_" + name }
}
func primitiveStateType(_ type: TypeSyntax) -> String? {
    if let value = type.as(OptionalTypeSyntax.self), let inner = primitiveStateType(value.wrappedType) { return inner + "?" }
    if let value = type.as(ArrayTypeSyntax.self), let inner = primitiveStateType(value.element) { return "[" + inner + "]" }
    if let value = type.as(DictionaryTypeSyntax.self), let key = primitiveStateType(value.key), let value = primitiveStateType(value.value) { return "[" + key + ": " + value + "]" }
    let raw = tokens(type).replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "Swift.", with: "")
    let primitives: Set<String> = ["Bool", "String", "Int", "UInt", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64", "Float", "Double"]
    if primitives.contains(raw) { return "Swift." + raw }
    if let value = type.as(IdentifierTypeSyntax.self), value.name.text == "Optional", let args = value.genericArgumentClause?.arguments,
       args.count == 1, let argument = args.first!.argument.as(TypeSyntax.self), let inner = primitiveStateType(argument) { return inner + "?" }
    return nil
}
func literalState(_ expression: ExprSyntax) -> Bool {
    if expression.is(BooleanLiteralExprSyntax.self) || expression.is(IntegerLiteralExprSyntax.self) || expression.is(FloatLiteralExprSyntax.self) || expression.is(NilLiteralExprSyntax.self) { return true }
    if let value = expression.as(StringLiteralExprSyntax.self) { return value.segments.allSatisfy { $0.is(StringSegmentSyntax.self) } }
    if let value = expression.as(PrefixOperatorExprSyntax.self) { return ["-", "+"].contains(value.operator.text) && (value.expression.is(IntegerLiteralExprSyntax.self) || value.expression.is(FloatLiteralExprSyntax.self)) }
    if let value = expression.as(ArrayExprSyntax.self) { return value.elements.allSatisfy { literalState($0.expression) } }
    if let value = expression.as(DictionaryExprSyntax.self) {
        if case .elements(let elements) = value.content { return elements.allSatisfy { literalState($0.key) && literalState($0.value) } }
        return true
    }
    return false
}
func addedStateField(_ node: VariableDeclSyntax, owner: String, module: String, path: String) throws -> AddedStateField {
    guard node.bindings.count == 1, node.bindingSpecifier.text == "var",
          !node.modifiers.contains(where: { ["static", "class", "lazy", "nonisolated", "public", "open", "package"].contains($0.name.text) }),
          let binding = node.bindings.first, binding.accessorBlock == nil,
          let name = binding.pattern.as(IdentifierPatternSyntax.self)?.identifier.text,
          name.range(of: "^[A-Za-z_][A-Za-z0-9_]{0,63}$", options: .regularExpression) != nil, !name.hasPrefix("__swiftSim"),
          let attribute = node.attributes.compactMap({ $0.as(AttributeSyntax.self) }).first(where: { ["State", "SwiftUI.State"].contains($0.attributeName.trimmedDescription) }),
          attribute.arguments == nil, node.attributes.compactMap({ $0.as(AttributeSyntax.self) }).filter({ statefulWrapperNames.contains($0.attributeName.trimmedDescription) }).count == 1 else { throw Failure(description: "new State needs one mutable instance field and a pure literal default") }
    let initial: ExprSyntax
    if let expression = binding.initializer?.value { initial = expression }
    else if let type = binding.typeAnnotation?.type, primitiveStateType(type)?.hasSuffix("?") == true { initial = ExprSyntax(NilLiteralExprSyntax()) }
    else { throw Failure(description: "new State needs a literal initializer") }
    guard initial.trimmedDescription.utf8.count <= 4096, literalState(initial) else { throw Failure(description: "new State object or effectful initializers need a Debug build") }
    let type: String
    if let annotation = binding.typeAnnotation?.type, let qualified = primitiveStateType(annotation) { type = qualified }
    else if binding.typeAnnotation != nil { throw Failure(description: "new State currently supports primitive value types, optionals, arrays and dictionaries") }
    else if initial.is(BooleanLiteralExprSyntax.self) { type = "Swift.Bool" }
    else if initial.is(StringLiteralExprSyntax.self) { type = "Swift.String" }
    else if initial.is(IntegerLiteralExprSyntax.self) { type = "Swift.Int" }
    else if initial.is(FloatLiteralExprSyntax.self) { type = "Swift.Double" }
    else if let prefix = initial.as(PrefixOperatorExprSyntax.self), prefix.expression.is(IntegerLiteralExprSyntax.self) { type = "Swift.Int" }
    else if let prefix = initial.as(PrefixOperatorExprSyntax.self), prefix.expression.is(FloatLiteralExprSyntax.self) { type = "Swift.Double" }
    else { throw Failure(description: "new State collections and nil require an explicit supported type") }
    let definition = [module, path, owner, name, type, tokens(initial)].joined(separator: "\u{0}")
    let key = SHA256.hash(data: Data(definition.utf8)).map { String(format: "%02x", $0) }.joined()
    let attributes = node.attributes.filter { $0.as(AttributeSyntax.self).map { !["State", "SwiftUI.State"].contains($0.attributeName.trimmedDescription) } ?? false }.trimmedDescription
    var shadowNames: Set<String> = ["Swift", "SwiftUI"]
    if attribute.attributeName.trimmedDescription == "State" { shadowNames.insert("State") }
    if binding.typeAnnotation == nil { shadowNames.formUnion(["IntegerLiteralType", "FloatLiteralType", "StringLiteralType", "BooleanLiteralType", "UnicodeScalarLiteralType", "ExtendedGraphemeClusterLiteralType"]) }
    for token in initial.tokens(viewMode: .sourceAccurate) where ["-", "+"].contains(token.text) { shadowNames.insert("prefix:" + token.text) }
    if let annotation = binding.typeAnnotation?.type {
        for token in annotation.tokens(viewMode: .sourceAccurate) { if case .identifier = token.tokenKind { shadowNames.insert(token.text) } }
        if annotation.trimmedDescription.hasPrefix("Swift.") { shadowNames = shadowNames.subtracting(["Bool", "Int", "String", "Double", "Float", "UInt", "Optional"]) }
    }
    return AddedStateField(owner: owner, name: name, type: type, initial: initial.trimmedDescription, key: key,
        modifiers: node.modifiers.trimmedDescription, attributes: attributes, shadowNames: shadowNames,
        wrapper: attribute.attributeName.trimmedDescription,
        sourceType: binding.typeAnnotation?.type.trimmedDescription ?? (type == "Swift.Bool" ? "BooleanLiteralType" : type == "Swift.String" ? "StringLiteralType" : type == "Swift.Int" ? "IntegerLiteralType" : "FloatLiteralType"))
}
func stateAccessors(_ fields: [AddedStateField], generation: UInt64, targetModule: String? = nil) throws -> [String] {
    guard fields.count <= 32, Set(fields.map(\.name)).count == fields.count else { throw Failure(description: "new State field limit or duplicate") }
    let keys = fields.map { "\"" + $0.key + "\"" }.joined(separator: ",")
    guard let first = fields.first else { return [] }
    let owner = targetModule.map { $0 + "." + first.owner } ?? first.owner
    let keyFunction = "__swiftSimAddedKeys_" + String(generation)
    return ["extension \(owner) { private static func \(keyFunction)() -> [Swift.String] { [\(keys)] } }"] + fields.map { field in
        let slot = "$__swiftSimRefresh", args = "\"\(field.key)\", initial: \(field.initial)"
        return """
        extension \(owner) {
        // Type-checked, never called: preserve the source wrapper/value identity
        // even when an imported associated type shadows an ordinary name.
        private static func __swiftSimAddedWitness_\(field.name)_\(generation)(_ value: \(field.wrapper)<\(field.sourceType)>) -> SwiftUI.State<\(field.type)> { value }
        \(field.attributes)
        \(field.modifiers) var \(field.name): \(field.type) {
          get { \(slot).value(\(args)) }
          nonmutating set { \(slot).set("\(field.key)", value: newValue, generation: \(generation), activeKeys: { Self.\(keyFunction)() }) }
        }
        \(field.attributes)
        private var \(field.bindingName): SwiftUI.Binding<\(field.type)> {
          \(slot).binding(\(args), generation: \(generation), activeKeys: { Self.\(keyFunction)() })
        }
        }
        """
    }
}
final class AddedStateBindings: SyntaxRewriter {
    let fields: [String: AddedStateField]
    var unsafe = false
    init(_ values: [AddedStateField]) { fields = Dictionary(uniqueKeysWithValues: values.map { ($0.name, $0) }) }
    override func visit(_ node: DeclReferenceExprSyntax) -> ExprSyntax {
        var result = node
        let name = node.baseName.text
        if name.hasPrefix("$"), let field = fields[String(name.dropFirst())] { result.baseName = .identifier(field.bindingName, leadingTrivia: node.baseName.leadingTrivia, trailingTrivia: node.baseName.trailingTrivia) }
        if name.hasPrefix("_"), fields[String(name.dropFirst())] != nil { unsafe = true }
        return ExprSyntax(result)
    }
    override func visit(_ node: MemberAccessExprSyntax) -> ExprSyntax {
        if node.declName.baseName.text.hasPrefix("$"), fields[String(node.declName.baseName.text.dropFirst())] != nil,
           node.base?.trimmedDescription != "self" { unsafe = true }
        return super.visit(node)
    }
    override func visit(_ node: VariableDeclSyntax) -> DeclSyntax {
        for binding in node.bindings { if let name = binding.pattern.as(IdentifierPatternSyntax.self)?.identifier.text, fields[name] != nil { unsafe = true } }
        return super.visit(node)
    }
    override func visit(_ node: ClosureExprSyntax) -> ExprSyntax {
        if node.signature?.tokens(viewMode: .sourceAccurate).contains(where: { fields[String($0.text.dropFirst())] != nil && $0.text.hasPrefix("$") }) == true { unsafe = true }
        return super.visit(node)
    }
    override func visit(_ node: FunctionParameterSyntax) -> FunctionParameterSyntax {
        if fields[node.secondName?.text ?? node.firstName.text] != nil { unsafe = true }
        return super.visit(node)
    }
}

final class AdditiveDeclarations {
    var emitted: [String] = []
    var additions: [[String: String]] = []
    var ranges: [Range<Int>] = []
    var sharedNames: [String] = []
    var components: [StatefulComponent] = []
    var addedStates: [AddedStateField] = []
    let addedStateOwners: Set<String>
    let module: String
    let sourcePath: String
    let allowStateful: Bool
    let origins: [Input.StatefulOrigin]
    let fileIndex: Int
    let generation: String
    let allowShared: Bool
    let availableModules: Set<String>
    let file: String
    init(file: String, modules: [String], allowShared: Bool = false, allowStateful: Bool = false,
         origins: [Input.StatefulOrigin] = [], fileIndex: Int = 0, generation: String = "",
         addedStateOwners: Set<String> = [], module: String = "", sourcePath: String = "") {
        self.file = file; availableModules = Set(modules); self.allowShared = allowShared
        self.allowStateful = allowStateful; self.origins = origins; self.fileIndex = fileIndex; self.generation = generation
        self.addedStateOwners = addedStateOwners; self.module = module; self.sourcePath = sourcePath
    }
    func admitted(_ modifiers: DeclModifierListSyntax, owner: String, name: String) -> Bool {
        if privateOnly(modifiers) { return true }
        guard allowShared, owner.isEmpty,
              !modifiers.contains(where: { ["public", "open", "package"].contains($0.name.text) }) else { return false }
        sharedNames.append(name)
        return true
    }
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
            let pinned = node.as(StructDeclSyntax.self).flatMap { value in origins.first { $0.owner == value.name.text } }
            let isComponent = allowStateful && owner.isEmpty && (statefulView(node) != nil || pinned != nil)
            let isAddedState = addedStateOwners.contains(owner) && node.as(VariableDeclSyntax.self)?.attributes.contains(where: {
                $0.as(AttributeSyntax.self).map { ["State", "SwiftUI.State"].contains($0.attributeName.trimmedDescription) } == true
            }) == true
            let check = AdditiveSyntaxGuard(allowStateful: isComponent || isAddedState); check.walk(node)
            guard !check.unsafe else { throw Failure(description: "additive macros, conditional declarations or unsupported attributes") }
            if isAddedState, let n = node.as(VariableDeclSyntax.self) {
                addedStates.append(try addedStateField(n, owner: owner, module: module, path: sourcePath))
            } else if let n = node.as(ImportDeclSyntax.self) {
                guard owner.isEmpty, n.attributes.isEmpty, n.importKindSpecifier == nil, n.path.count == 1,
                      let module = n.path.first?.name.text, availableModules.contains(module) else {
                    throw Failure(description: "added import is unavailable in the captured context")
                }
            } else if let n = node.as(FunctionDeclSyntax.self) {
                guard admitted(n.modifiers, owner: owner, name: n.name.text), n.body != nil else { throw Failure(description: "added function must have bounded access and a body") }
                emitted.append(owner.isEmpty ? n.trimmedDescription : "extension \(owner) {\n\(n.trimmedDescription)\n}")
            } else if let n = node.as(StructDeclSyntax.self), owner.isEmpty, admitted(n.modifiers, owner: owner, name: n.name.text) {
                if isComponent {
                    let component = try componentPlan(n, origin: origins.first { $0.owner == n.name.text },
                        fileIndex: 32 + fileIndex * 32 + components.count, generation: generation,
                        allowAddedState: !addedStateOwners.isEmpty, module: module, path: sourcePath)
                    components.append(component); addedStates += component.addedStates
                    if component.origin == nil { emitted.append(component.source) }
                } else { emitted.append(n.trimmedDescription) }
            } else if let n = node.as(EnumDeclSyntax.self), owner.isEmpty, admitted(n.modifiers, owner: owner, name: n.name.text) {
                emitted.append(n.trimmedDescription)
            } else if let n = node.as(TypeAliasDeclSyntax.self), owner.isEmpty, admitted(n.modifiers, owner: owner, name: n.name.text) {
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

// Compare names at module scope, including inactive conditional branches.
// Instance members do not share this namespace.
struct ScopedTypeName {
    let path: String; let owner: String; let name: String; let fileOnly: Bool
}
func declaredTypeNames(_ tree: SourceFileSyntax, path: String, module: String) -> [ScopedTypeName] {
    final class Types: SyntaxVisitor {
        var names: [ScopedTypeName] = [], owners: [String] = [], privateExtensions: [Bool] = []
        let path: String; let module: String
        init(path: String, module: String) { self.path = path; self.module = module; super.init(viewMode: .sourceAccurate) }
        func record(_ name: String, _ modifiers: DeclModifierListSyntax) {
            names.append(ScopedTypeName(path: path, owner: owners.joined(separator: "."), name: name,
                fileOnly: privateExtensions.contains(true) || modifiers.contains { ["private", "fileprivate"].contains($0.name.text) }))
        }
        override func visit(_ n: StructDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); owners.append(n.name.text); return .visitChildren }
        override func visitPost(_ n: StructDeclSyntax) { owners.removeLast() }
        override func visit(_ n: EnumDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); owners.append(n.name.text); return .visitChildren }
        override func visitPost(_ n: EnumDeclSyntax) { owners.removeLast() }
        override func visit(_ n: ClassDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); owners.append(n.name.text); return .visitChildren }
        override func visitPost(_ n: ClassDeclSyntax) { owners.removeLast() }
        override func visit(_ n: ActorDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); owners.append(n.name.text); return .visitChildren }
        override func visitPost(_ n: ActorDeclSyntax) { owners.removeLast() }
        override func visit(_ n: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); owners.append(n.name.text); return .visitChildren }
        override func visitPost(_ n: ProtocolDeclSyntax) { owners.removeLast() }
        override func visit(_ n: TypeAliasDeclSyntax) -> SyntaxVisitorContinueKind { record(n.name.text, n.modifiers); return .skipChildren }
        override func visit(_ n: ExtensionDeclSyntax) -> SyntaxVisitorContinueKind {
            let name = n.extendedType.trimmedDescription
            owners.append(name.hasPrefix(module + ".") ? String(name.dropFirst(module.count + 1)) : name)
            privateExtensions.append(n.modifiers.contains { ["private", "fileprivate"].contains($0.name.text) }); return .visitChildren
        }
        override func visitPost(_ n: ExtensionDeclSyntax) { owners.removeLast(); privateExtensions.removeLast() }
        override func visit(_ n: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
            if n.modifiers.contains(where: { $0.name.text == "prefix" }) { record("prefix:" + n.name.text, n.modifiers) }
            return .skipChildren
        }
        override func visit(_ n: InitializerDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
        override func visit(_ n: VariableDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
    }
    let visitor = Types(path: path, module: module); visitor.walk(tree); return visitor.names
}
func moduleNames(_ tree: SourceFileSyntax) -> Set<String> {
    final class Names: SyntaxVisitor {
        var values = Set<String>()
        init() { super.init(viewMode: .sourceAccurate) }
        override func visit(_ n: StructDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: ClassDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: ActorDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: EnumDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: FunctionDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: TypeAliasDeclSyntax) -> SyntaxVisitorContinueKind { values.insert(n.name.text); return .skipChildren }
        override func visit(_ n: ExtensionDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
        override func visit(_ n: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
            for binding in n.bindings { for token in binding.pattern.tokens(viewMode: .sourceAccurate) {
                if case .identifier = token.tokenKind { values.insert(token.text) }
            } }
            return .skipChildren
        }
    }
    let names = Names(); names.walk(tree); return names.values
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
    var statefulComponents: [[String: Any]] = []
    var originUses: [[String: String]] = []
    var componentDependencies: [(Set<String>, Set<String>)] = []
    var coverage: [[String: Any]] = []
    var additions: [[String: String]] = []
    var additiveContext = false
    var sharedNames: [String] = []
    var sharedContext = false
    var addedOwners: [[String: Any]] = []
    var usesAddedState = false
    var addedStateLookups: [(path: String, owner: String, names: Set<String>)] = []
    for (fileIndex, file) in input.files.enumerated() {
        let baseline = input.allowAdditive == true ? (file.installedBaseline ?? file.before) : file.before
        guard file.isNewFile != true || (input.allowSharedAdditive == true && baseline.isEmpty) else { throw Failure(description: "new file requires empty installed baseline and shared admission") }
        let origins = (input.statefulOrigins ?? []).filter { $0.path == file.path }
        let allowedStateOwners = input.allowAddedState == true ? Set((input.statefulBodies?[file.path] ?? []) + origins.filter { $0.stateNames != nil }.map(\.owner)) : []
        let plan = AdditiveDeclarations(file: filenames[fileIndex], modules: input.availableModules ?? [], allowShared: input.allowSharedAdditive == true,
            allowStateful: input.allowStatefulAdditive == true, origins: origins, fileIndex: fileIndex, generation: input.generation,
            addedStateOwners: allowedStateOwners, module: input.module, sourcePath: file.path)
        let priorPlan = AdditiveDeclarations(file: filenames[fileIndex], modules: input.availableModules ?? [], allowShared: input.allowSharedAdditive == true,
            allowStateful: input.allowStatefulAdditive == true, origins: origins, fileIndex: fileIndex, generation: input.generation,
            addedStateOwners: allowedStateOwners, module: input.module, sourcePath: file.path)
        let desiredSource = input.allowAdditive == true ? try plan.strip(baseline: baseline, desired: file.after) : file.after
        let previousSource = input.allowAdditive == true ? try priorPlan.strip(baseline: baseline, desired: file.before) : file.before
        let stateOwners = Set(plan.addedStates.map(\.owner)).union(priorPlan.addedStates.map(\.owner))
        if !stateOwners.isEmpty {
            guard let sequence = input.stateGeneration, sequence > 0 else { throw Failure(description: "new State needs a durable generation") }
            usesAddedState = true
            for field in plan.addedStates + priorPlan.addedStates { addedStateLookups.append((file.path, field.owner, field.shadowNames)) }
            for owner in stateOwners.sorted() {
                let fields = plan.addedStates.filter { $0.owner == owner }, priorFields = priorPlan.addedStates.filter { $0.owner == owner }
                for field in fields {
                    if let old = priorFields.first(where: { $0.name == field.name }), old.key != field.key { throw Failure(description: "added State type/default changed; build a new Debug app for this edit") }
                }
                if file.after != baseline && !Set(priorFields.map(\.name)).isSubset(of: Set(fields.map(\.name))) { throw Failure(description: "removing or renaming added State needs a Debug build; only whole-baseline restoration is supported") }
                plan.emitted += try stateAccessors(fields, generation: sequence, targetModule: origins.first { $0.owner == owner }?.module)
                addedOwners.append(["path": file.path, "owner": owner, "fields": fields.map { ["name": $0.name, "key": $0.key, "type": $0.type] }])
            }
        }
        additions += plan.additions
        additiveContext = additiveContext || !plan.additions.isEmpty || !priorPlan.additions.isEmpty
        sharedNames += plan.sharedNames
        sharedContext = sharedContext || file.isNewFile == true || !plan.sharedNames.isEmpty || !priorPlan.sharedNames.isEmpty
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
        var chunks = ["@_private(sourceFile: \(encoded)) import \(input.module)"] + imports
        if !plan.components.isEmpty || !stateOwners.isEmpty { chunks.append("import SwiftSimLive\nimport SwiftUI") }
        let activeOrigins = (input.statefulOrigins ?? []).filter { origin in
            input.files.contains { candidate in candidate.path == origin.path && Parser.parse(source: candidate.after).statements.contains {
                $0.item.as(StructDeclSyntax.self)?.name.text == origin.owner
            } }
        }
        let groupedOrigins = Dictionary(grouping: activeOrigins, by: \.module)
        for module in groupedOrigins.keys.sorted() {
            let moduleOrigins = groupedOrigins[module]!
            let sourceFile = moduleOrigins.first(where: { $0.path == file.path })?.sourceFile
                ?? "SwiftSimExternal_\(input.generation)_\(fileIndex).swift"
            let name = String(data: try JSONEncoder().encode(sourceFile), encoding: .utf8)!
            chunks.append("@_private(sourceFile: \(name)) import \(module)")
        }
        chunks += plan.emitted
        var replacements = new.members.filter { previous[$0.key]?.body != $0.body || incremental[$0.key]?.body != $0.body || (stateOwners.contains($0.owner) && $0.target == "body") }
            .map { ($0, Optional<String>.none) }
        for component in plan.components {
            componentDependencies.append((component.storageNames, component.bareWrappers))
            if let origin = component.origin {
                originUses.append(["path": file.path, "owner": origin.owner, "module": origin.module,
                    "sourceFile": origin.sourceFile, "layoutDigest": origin.layoutDigest])
                replacements += component.members.map { ($0, Optional(origin.module)) }
            } else {
                var metadata: [String: Any] = ["path": file.path, "owner": component.owner, "layoutDigest": component.layoutDigest,
                    "sourceFileIndex": fileIndex, "slots": component.members.map { member in
                        ["member": member.target, "kind": member.kind, "accessors": member.accessors, "isStatic": member.isStatic] as [String: Any]
                    }]
                if let names = component.stateNames { metadata["stateNames"] = names }
                statefulComponents.append(metadata)
            }
        }
        for (member, targetModule) in replacements {
            // Local nominal declarations need their own metadata/coexistence proof.
            let bodyTree = Parser.parse(source: member.replacement)
            let localTypes = LocalTypes(); localTypes.walk(bodyTree)
            guard !localTypes.found else { throw Failure(description: "changed body contains local nominal metadata") }
            let magic = SourceContextExpressions(); magic.walk(bodyTree)
            guard !magic.found else { throw Failure(description: "source-context expression needs explicit original-context lowering") }
            if stateOwners.contains(member.owner), member.kind == "property", member.target != "body",
               member.declaration.range(of: "\\bsome\\b", options: .regularExpression) != nil { throw Failure(description: "added State in opaque computed helpers needs explicit ABI qualification") }
            var replacement = member.replacement
            if member.target == "body", targetModule != nil || input.statefulBodies?[file.path]?.contains(member.owner) == true {
                let tree = Parser.parse(source: replacement)
                guard var property = tree.statements.first?.item.as(VariableDeclSyntax.self),
                      var binding = property.bindings.first, let block = binding.accessorBlock,
                      case .getter(let statements) = block.accessors else { throw Failure(description: "stateful body shape changed") }
                binding.typeAnnotation = TypeAnnotationSyntax(type: TypeSyntax(IdentifierTypeSyntax(name: .identifier("SwiftUI.AnyView"))))
                binding.accessorBlock = statefulBody(statements, lineCount: block.description.filter { $0 == "\n" }.count)
                property.bindings = PatternBindingListSyntax([binding])
                replacement = property.description
            }
            let stateBindings = AddedStateBindings(plan.addedStates.filter { $0.owner == member.owner })
            replacement = stateBindings.rewrite(Parser.parse(source: replacement)).description
            guard !stateBindings.unsafe else { throw Failure(description: "new State backing storage, shadowing or external projected access needs a build") }
            let declaration = "@_dynamicReplacement(for: \(member.target))\n\(replacement)"
            let owner = targetModule.map { $0 + "." + member.owner } ?? member.owner
            chunks.append(member.owner.isEmpty ? declaration : "\(member.contextAttributes)\nextension \(owner) {\n\(declaration)\n}")
            var covered: [String: Any] = ["file": filename, "line": member.line, "member": member.target, "owner": member.owner,
                             "bodyStartUTF8": member.lower, "bodyEndUTF8": member.upper,
                             "replacementName": member.replacementName, "kind": member.kind, "accessors": member.accessors,
                             "isStatic": member.isStatic]
            if let targetModule { covered["targetModule"] = targetModule }
            coverage.append(covered)
        }
        generated.append(chunks.joined(separator: "\n"))
    }
    if sharedContext || !componentDependencies.isEmpty || usesAddedState {
        guard input.allowSharedAdditive == true, let originals = input.moduleSources, !originals.isEmpty, originals.count <= 2048,
              Set(originals.map(\.path)).count == originals.count else { throw Failure(description: "shared additions require original module inventory") }
        var installedNames = Set<String>()
        var scopedTypes: [ScopedTypeName] = []
        for file in originals {
            let tree = Parser.parse(source: file.source)
            guard !tree.hasError else { throw Failure(description: "invalid original module inventory") }
            installedNames.formUnion(moduleNames(tree))
            scopedTypes += declaredTypeNames(tree, path: file.path, module: input.module)
        }
        let addedNames = input.files.reduce(into: Set<String>()) { result, file in
            let original = moduleNames(Parser.parse(source: file.installedBaseline ?? file.before))
            result.formUnion(moduleNames(Parser.parse(source: file.after)).subtracting(original))
        }
        if usesAddedState {
            for file in input.files { scopedTypes += declaredTypeNames(Parser.parse(source: file.after), path: file.path, module: input.module) }
            for lookup in addedStateLookups {
                let parts = lookup.owner.split(separator: ".")
                let scopes = Set([""] + (1...parts.count).map { parts.prefix($0).joined(separator: ".") })
                guard !scopedTypes.contains(where: { scopes.contains($0.owner) && (!$0.fileOnly || $0.path == lookup.path) && lookup.names.contains($0.name) }) else {
                    throw Failure(description: "new State lowering cannot change shadowed built-ins or literal operators")
                }
            }
        }
        for (storageNames, wrappers) in componentDependencies {
            guard storageNames.isDisjoint(with: addedNames), wrappers.isDisjoint(with: installedNames.union(addedNames)) else {
                throw Failure(description: "stateful component storage captures a patch-local declaration or shadowed SwiftUI wrapper")
            }
        }
        guard Set(sharedNames).count == sharedNames.count, installedNames.isDisjoint(with: sharedNames) else {
            throw Failure(description: "shared name collides with installed or added declaration")
        }
    }
    guard statefulComponents.count + originUses.count <= 32 else { throw Failure(description: "stateful component limit") }
    let preserving = !coverage.isEmpty && coverage.allSatisfy {
        if $0["targetModule"] as? String != nil { return true }
        guard let owner = $0["owner"] as? String,
              ($0["member"] as? String == "body" || (addedOwners.contains { item in item["owner"] as? String == owner } && $0["kind"] as? String == "property" && $0["isStatic"] as? Bool == false) || ((input.allowAdditive == true || input.preserveViewFunctions == true) && $0["kind"] as? String == "function" && $0["isStatic"] as? Bool == false)),
              let filename = $0["file"] as? String else { return false }
        return input.files.contains { file in URL(fileURLWithPath: file.path).lastPathComponent == filename
            && input.statefulBodies?[file.path]?.contains(owner) == true }
    }
    var output: [String: Any] = ["schemaVersion": 1, "capability": "full-callable-v1", "generation": input.generation, "module": input.module,
            "refreshStrategy": preserving ? "preserve-state-v1" : "remount",
            "changedMemberCount": coverage.count, "members": coverage, "sources": generated,
            "additiveProtocol": additiveContext || sharedContext ? 1 : 0, "additions": additions,
            "sharedAdditive": sharedContext,
            "statefulComponentProtocol": statefulComponents.isEmpty && originUses.isEmpty ? 0 : 1,
            "statefulComponents": statefulComponents, "statefulOriginUses": originUses,
            "requiresPrivateScopes": additiveContext || sharedContext]
    if usesAddedState {
        output["addedStateProtocol"] = 1; output["addedStateGeneration"] = input.stateGeneration!
        output["addedStateOwners"] = addedOwners
    }
    return output
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
