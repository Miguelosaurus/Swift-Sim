// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SwiftSimLive",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "SwiftSimLive", targets: ["SwiftSimLive"]),
    ],
    dependencies: [
        // Keep this on the immutable Swift Sim engine-fork revision. The
        // upstream semver tags do not contain Swift Sim's control protocol,
        // and a stable Swift Sim package cannot transitively depend on an
        // unstable revision under Swift Package Manager.
        .package(
            url: "https://github.com/Miguelosaurus/InjectionNext.git",
            revision: "a3341b6a861dde031334813db49f7c7111108c4a"
        ),
    ],
    targets: [
        .target(
            name: "SwiftSimLive",
            dependencies: [
                .product(name: "InjectionNext", package: "InjectionNext"),
            ]
        ),
        .testTarget(
            name: "SwiftSimLiveTests",
            dependencies: ["SwiftSimLive"]
        ),
    ]
)
