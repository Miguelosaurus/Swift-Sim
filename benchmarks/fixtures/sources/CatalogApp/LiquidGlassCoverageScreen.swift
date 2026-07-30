import SwiftUI
@available(iOS 26.1, *)
struct LiquidGlassCoverageScreen: View {
    @Namespace private var glassNamespace
    private let storedGlass: Glass = .regular
    // extra-namespace-slot
    // extra-state-slot
    // extra-member-slot
    // extra-attribute-slot
    var body: some View {
        ScrollView {
            VStack(spacing: 4) {
                BenchmarkMarkerView(value: "glass-variant").glassEffect(.regular)
                BenchmarkMarkerView(value: "glass-material-identity").glassEffect(.identity)
                BenchmarkMarkerView(value: "glass-tint").glassEffect(.regular.tint(.blue))
                BenchmarkMarkerView(value: "glass-interactive").glassEffect(.regular.interactive(false))
                BenchmarkMarkerView(value: "glass-shape").glassEffect(.regular, in: .rect(cornerRadius: 12))
                BenchmarkMarkerView(value: "glass-default-shape").glassEffect()
                BenchmarkMarkerView(value: "glass-concentric-shape").glassEffect(.regular, in: .rect(corners: .concentric, isUniform: false))
                GlassEffectContainer(spacing: 12) { BenchmarkMarkerView(value: "glass-container").glassEffect() }
                BenchmarkMarkerView(value: "glass-identity").glassEffect().glassEffectID("primary", in: glassNamespace)
                HStack { BenchmarkMarkerView(value: "glass-union").glassEffect() }.glassEffectUnion(id: "group-a", namespace: glassNamespace)
                BenchmarkMarkerView(value: "glass-transition").glassEffect().glassEffectID("transition", in: glassNamespace).glassEffectTransition(.materialize)
                Button {} label: { BenchmarkMarkerView(value: "glass-button-style") }.buttonStyle(.glass)
                Button {} label: { BenchmarkMarkerView(value: "glass-configured-button") }.buttonStyle(.glass(.regular.tint(.blue)))
                BenchmarkMarkerView(value: "toolbar-spacer").toolbar { ToolbarSpacer(.fixed); ToolbarItem { Image(systemName: "star") } }
                BenchmarkMarkerView(value: "toolbar-shared-background").toolbar { ToolbarItem { Image(systemName: "circle") }.sharedBackgroundVisibility(.visible) }
                BenchmarkMarkerView(value: "toolbar-background").toolbarBackgroundVisibility(.visible, for: .navigationBar)
                BenchmarkMarkerView(value: "scroll-edge-style").scrollEdgeEffectStyle(.soft, for: .top)
                BenchmarkMarkerView(value: "scroll-edge-hidden").scrollEdgeEffectHidden(false, for: .top)
                BenchmarkMarkerView(value: "background-extension").backgroundExtensionEffect(isEnabled: false)
                BenchmarkMarkerView(value: "safe-area-bar").safeAreaBar(edge: .bottom, alignment: .center, spacing: 8) { Text("Status") }
                BenchmarkMarkerView(value: "tab-minimize").tabBarMinimizeBehavior(.never)
                TabView { BenchmarkMarkerView(value: "tab-accessory") }.tabViewBottomAccessory(isEnabled: false) { Text("Accessory") }
                BottomAccessoryPlacementProbe()
                TabView { Tab("Search", systemImage: "magnifyingglass", role: nil) { BenchmarkMarkerView(value: "search-tab-role") } }
                BenchmarkMarkerView(value: "search-presentation").searchable(text: .constant(""), isPresented: .constant(false), prompt: "Find")
                BenchmarkMarkerView(value: "toolbar-title").toolbarTitleDisplayMode(.inline)
                BenchmarkMarkerView(value: "control-size").controlSize(.regular)
            }
        }
    }

    private struct BottomAccessoryPlacementProbe: View {
        @Environment(\.tabViewBottomAccessoryPlacement) private var placement
        var body: some View { BenchmarkMarkerView(value: "tab-accessory-placement").opacity(placement == .inline ? 0.9 : 1.0) }
    }
}
