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
        VStack(spacing: 0) {
            CatalogScreen()
            if #available(iOS 26.1, *) {
                LiquidGlassCoverageScreen()
                NativeSurfaceCoverageScreen()
            }
        }
        #elseif STATE_APP
        StateScreen()
        #else
        ArchitectureScreen()
        #endif
    }
}
