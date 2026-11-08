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
        // The exact engine-fork tag points to the revision declared in
        // mac-helper/compatibility.json. A stable Swift package must use
        // a versioned dependency so fresh Xcode installs resolve normally.
        .package(
            url: "https://github.com/Miguelosaurus/InjectionNext.git",
            exact: "0.5.8"
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
