import Foundation
import SwiftUI
// extra-import-slot
// native-import-end-slot

@available(iOS 26.1, *)
struct NativeSurfaceCoverageScreen: View {
    @State private var nativePath: [String] = []
    @State private var splitVisibility: NavigationSplitViewVisibility = .automatic
    @Namespace private var nativeNamespace
    private let storedSurfaceTitle: String = "Native surfaces"
    // extra-state-slot
    // extra-namespace-slot
    // extra-member-slot
    // native-member-end-slot

    var body: some View {
        NavigationStack(path: $nativePath) {
            ScrollView {
                VStack(spacing: 8) {
                    Text(storedSurfaceTitle).font(.headline)
                    Menu { Button("Menu Action") {} } label: { BenchmarkMarkerView(value: "native-menu") }
                    BenchmarkMarkerView(value: "native-context-menu").contextMenu { Button("Context Action") {} }
                    BenchmarkMarkerView(value: "native-confirmation-dialog").confirmationDialog("Confirm Action", isPresented: .constant(false), titleVisibility: .visible) { Button("Confirm") {} }
                    BenchmarkMarkerView(value: "native-sheet").sheet(isPresented: .constant(false)) { Text("Sheet Content").presentationDetents([.medium]) }
                    BenchmarkMarkerView(value: "native-popover").popover(isPresented: .constant(false)) { Text("Popover Content") }
                    BenchmarkMarkerView(value: "native-navigation-stack").navigationTitle("Navigation")
                    NavigationLink(value: "detail") { BenchmarkMarkerView(value: "native-navigation-link") }
                    VStack { BenchmarkMarkerView(value: "native-picker"); Picker("Native Picker", selection: .constant("one")) { Text("One").tag("one"); Text("Two").tag("two") } }.pickerStyle(.segmented)
                    ControlGroup { Button {} label: { BenchmarkMarkerView(value: "native-control-group") }; Button("Second") {} }.controlGroupStyle(.menu)
                    List { Section("Native List") { BenchmarkMarkerView(value: "native-list") } }.listStyle(.insetGrouped).frame(height: 120)
                    Form { Section("Native Form") { BenchmarkMarkerView(value: "native-form") } }.formStyle(.grouped).frame(height: 120)
                    ShareLink(item: "Native Surface") { BenchmarkMarkerView(value: "native-share-link") }
                    Toggle(isOn: .constant(true)) { BenchmarkMarkerView(value: "native-toggle") }.toggleStyle(.switch)
                    Stepper(value: .constant(1), in: 0...3) { BenchmarkMarkerView(value: "native-stepper") }
                    VStack { BenchmarkMarkerView(value: "native-slider"); Slider(value: .constant(0.5), in: 0...1) }
                    DatePicker(selection: .constant(Date()), displayedComponents: .date) { BenchmarkMarkerView(value: "native-date-picker") }
                    VStack { BenchmarkMarkerView(value: "native-text-field"); TextField("Native Field", text: .constant("")) }
                    ProgressView(value: 0.5) { BenchmarkMarkerView(value: "native-progress") }
                    NavigationSplitView(columnVisibility: $splitVisibility) { BenchmarkMarkerView(value: "native-split-sidebar") } detail: { BenchmarkMarkerView(value: "native-split-detail") }.navigationSplitViewStyle(.balanced)
                    VStack { BenchmarkMarkerView(value: "native-search"); Text("Search host") }.searchable(text: .constant(""), placement: .toolbar, prompt: "Search")
                    BenchmarkMarkerView(value: "native-toolbar-role").toolbarRole(.editor)
                    BenchmarkMarkerView(value: "native-toolbar-title").navigationBarTitleDisplayMode(.inline)
                    BenchmarkMarkerView(value: "native-presentation-detent").sheet(isPresented: .constant(false)) { Text("Detent Content").presentationDetents([.medium]) }
                    BenchmarkMarkerView(value: "native-presentation-drag").sheet(isPresented: .constant(false)) { Text("Drag Content").presentationDragIndicator(.visible) }
                }
                .padding()
            }
            .navigationDestination(for: String.self) { value in BenchmarkMarkerView(value: "native-destination").overlay(Text(value)) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button {} label: { BenchmarkMarkerView(value: "native-toolbar-leading") } }
                ToolbarItemGroup(placement: .topBarTrailing) { Button {} label: { BenchmarkMarkerView(value: "native-toolbar-group") } }
            }
        }
    }
}
