import SwiftUI
import SwiftSimLive

@main
struct HotReloadBenchmarkApp: App {
    var body: some Scene {
        WindowGroup {
            BenchmarkRootView()
                .swiftSimLive()
        }
    }
}

struct BenchmarkRootView: View {
    var body: some View {
        #if CATALOG_APP
        CatalogScreen()
        #elseif STATE_APP
        StateScreen()
        #else
        ArchitectureScreen()
        #endif
    }
}
