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
        .package(
            url: "https://github.com/Miguelosaurus/InjectionNext.git",
            revision: "abdf646"
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
