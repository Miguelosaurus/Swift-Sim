// swift-tools-version: 6.2
import PackageDescription

let swiftSyntaxRepository = "https://github.com/" + "swiftlang/swift-syntax.git"

let package = Package(
    name: "SwiftSimAnalyzerProbe",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "swift-sim-analyzer-probe", targets: ["SwiftSyntaxProbe"])],
    dependencies: [.package(url: swiftSyntaxRepository, exact: "602.0.0")],
    targets: [
        .executableTarget(
            name: "SwiftSyntaxProbe",
            dependencies: [
                .product(name: "SwiftSyntax", package: "swift-syntax"),
                .product(name: "SwiftParser", package: "swift-syntax")
            ],
            path: ".",
            sources: ["Probe.swift"]
        )
    ]
)
