import Foundation
import CryptoKit
import ImageIO
import UIKit

struct AppIconReference: Hashable, Sendable {
    let digest: String
    let url: URL
    let authorization: String?

    init?(digest: String?, buildID: String, baseURL: URL, token: String, pairedMac: PairedMac?) {
        guard let digest, digest.count == 64, digest.allSatisfy({ "0123456789abcdef".contains($0) }),
              !buildID.isEmpty, buildID.count <= 128, buildID.allSatisfy({ $0.isLetter || $0.isNumber || "_-".contains($0) }) else { return nil }
        let base = pairedMac?.baseURL ?? baseURL
        guard ["https", "http"].contains(base.scheme?.lowercased() ?? ""), base.host != nil,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil else { return nil }
        self.digest = digest
        var url = base.appending(path: "api/device-builds/\(buildID)/artifact/icon")
        if let pairedMac { authorization = "Bearer \(pairedMac.token)" }
        else {
            guard !token.isEmpty else { return nil }
            authorization = nil
            url = url.appending(queryItems: [.init(name: "token", value: token)])
        }
        self.url = url
    }
}

private final class IconRedirectFence: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor AppIconCache {
    static let shared = AppIconCache()
    private var memory: [String: Data] = [:]
    private var order: [String] = []
    private let session = URLSession(configuration: .ephemeral, delegate: IconRedirectFence(), delegateQueue: nil)
    private let maximumBytes = 128 * 1024
    private let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        .appending(path: "SwiftSimAppIcons", directoryHint: .isDirectory)

    func data(for reference: AppIconReference) async -> Data? {
        if let cached = memory[reference.digest] { return cached }
        let file = directory.appending(path: "\(reference.digest).png")
        if let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maximumBytes,
           let cached = try? Data(contentsOf: file), Self.isValid(cached, digest: reference.digest) {
            remember(cached, digest: reference.digest)
            return cached
        }
        do {
            var request = URLRequest(url: reference.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
            if let authorization = reference.authorization { request.setValue(authorization, forHTTPHeaderField: "Authorization") }
            let (bytes, response) = try await session.bytes(for: request)
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  response.mimeType == "image/png", response.expectedContentLength <= Int64(maximumBytes) else { return nil }
            var data = Data()
            for try await byte in bytes {
                guard !Task.isCancelled, data.count < maximumBytes else { return nil }
                data.append(byte)
            }
            guard Self.isValid(data, digest: reference.digest) else { return nil }
            remember(data, digest: reference.digest)
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? data.write(to: file, options: .atomic)
            trimDisk()
            return data
        } catch { return nil }
    }

    private func remember(_ data: Data, digest: String) {
        memory[digest] = data; order.removeAll { $0 == digest }; order.append(digest)
        while order.count > 24 { memory.removeValue(forKey: order.removeFirst()) }
    }

    private func trimDisk() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let icons = files.filter { $0.pathExtension == "png" && $0.deletingPathExtension().lastPathComponent.count == 64 }
            .sorted { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
                > ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
        for file in icons.dropFirst(32) { try? FileManager.default.removeItem(at: file) }
    }

    nonisolated static func isValid(_ data: Data, digest: String) -> Bool {
        guard data.count >= 24, data.count <= 128 * 1024,
              data.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]),
              String(data: data[12..<16], encoding: .ascii) == "IHDR" else { return false }
        let width = data[16..<20].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let height = data[20..<24].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        return width > 0 && height > 0 && width <= 256 && height <= 256
            && SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() == digest
    }

    @MainActor static func image(from data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 256, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
