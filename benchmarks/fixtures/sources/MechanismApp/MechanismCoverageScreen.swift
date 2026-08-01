import Foundation
import Observation
import SwiftUI
import UIKit

struct MechanismCoverageScreen: View {
    @State private var model = MechanismObservableModel()
    @MechanismStringWrapper private var wrappedMarker = "wrapper-01"
    private let storedMechanismTitle = "Mechanisms"

    var body: some View {
        VStack(spacing: 4) {
            Text(storedMechanismTitle)
            BenchmarkMarkerView(value: "mechanism-baseline")
            BenchmarkMarkerView(caseID: "protocol-default", value: MechanismProtocolConformer().protocolValue())
            BenchmarkMarkerView(caseID: "actor-method", value: MechanismCoverageActor.value())
            MechanismExtensionCoverageView()
            BenchmarkMarkerView(caseID: "observation-computed", value: model.displayValue)
            BenchmarkMarkerView(caseID: "property-wrapper-getter", value: wrappedMarker)
            BenchmarkMarkerView(caseID: "parameterized-helper", value: MechanismParameterHelper.label(for: "input"))
            BenchmarkMarkerView(caseID: "initializer-body", value: MechanismInitializerProbe(value: "input").value)
            BenchmarkMarkerView(caseID: "accessor-getter", value: MechanismAccessorProbe().value)
            BenchmarkMarkerView(caseID: "subscript-body", value: MechanismSubscriptProbe()[0])
            BenchmarkMarkerView(caseID: "generic-helper", value: MechanismGenericProbe.label(7))
            BenchmarkMarkerView(caseID: "uikit-display-value", value: MechanismUIKitProbe.displayValue())
            BenchmarkMarkerView(caseID: "modifier-host", value: "modifier-host")
                .modifier(MechanismCoverageModifier())
            MechanismUIKitProbe(marker: MechanismUIKitProbe.displayValue())
            MechanismAsyncProbeView()
        }
    }
}

protocol MechanismCoverageProtocol {
    func protocolValue() -> String
}

struct MechanismProtocolConformer: MechanismCoverageProtocol {}

extension MechanismCoverageProtocol {
    func protocolValue() -> String { "protocol-01" }
}

actor MechanismCoverageActor {
    nonisolated static func value() -> String { "actor-01" }
}

struct MechanismExtensionCoverageView: View {}

extension MechanismExtensionCoverageView {
    var body: some View {
        BenchmarkMarkerView(caseID: "extension-view-body", value: "extension-01")
    }
}

struct MechanismCoverageModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay(
            BenchmarkMarkerView(caseID: "modifier-body", value: "modifier-01")
        )
    }
}

@Observable
final class MechanismObservableModel {
    var displayValue: String { "observation-01" }
}

@propertyWrapper
struct MechanismStringWrapper {
    private var storage: String

    init(wrappedValue: String) {
        storage = wrappedValue
    }

    var wrappedValue: String { storage }
}

struct MechanismParameterHelper {
    static func label(for value: String) -> String { "parameter-01" }
}

struct MechanismInitializerProbe {
    let value: String

    init(value: String) {
        self.value = "initializer-01"
    }
}

struct MechanismAccessorProbe {
    private let storage = "accessor-storage"

    var value: String {
        get { "accessor-01" }
        set { _ = newValue }
    }
}

struct MechanismSubscriptProbe {
    subscript(index: Int) -> String { "subscript-01" }
}

struct MechanismGenericProbe {
    static func label<T: CustomStringConvertible>(_ value: T) -> String { "generic-01" }
}

struct MechanismAsyncProbe {
    static func value(_ input: String) async throws -> String { "async-01" }
}

struct MechanismAsyncProbeView: View {
    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .task {
                let value = (try? await MechanismAsyncProbe.value("input")) ?? "async-error"
                BenchmarkMarker.emit(caseID: "async-parameterized", value: value)
            }
    }
}

struct MechanismUIKitProbe: UIViewRepresentable {
    var marker: String

    static func displayValue() -> String { "uikit-display-01" }

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.text = marker
        return label
    }

    func updateUIView(_ uiView: UILabel, context: Context) {
        uiView.text = marker
        BenchmarkMarker.emit(caseID: "uikit-update-view", value: "uikit-update-01")
    }
}

// mechanism-import-slot
