#if DEBUG && canImport(MetalKit)
import Foundation
import MetalKit
import Testing
@testable import SwiftSimLive

@Test
func rippleCaptureIsBoundedForPhoneAndLargeWindows() {
    for size in [CGSize(width: 402, height: 874), CGSize(width: 2048, height: 2732), CGSize(width: 6000, height: 4000)] {
        let scale = SwiftSimReloadRipple.snapshotScale(size: size, nativeScale: 3)
        #expect(scale <= 2)
        #expect(size.width * size.height * scale * scale <= 4_000_001)
    }
}

@Test(.enabled(if: MTLCreateSystemDefaultDevice() != nil))
func actualShaderPushesPixelsOutThenBackAndHasNoWaveBeforeContact() throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let library = try device.makeLibrary(source: SwiftSimReloadShader.source, options: nil)
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = library.makeFunction(name: "reloadVertex")
    descriptor.fragmentFunction = library.makeFunction(name: "reloadFragment")
    descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
    let pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm,
        width: 256, height: 256, mipmapped: false)
    textureDescriptor.storageMode = .shared
    textureDescriptor.usage = [.shaderRead, .renderTarget]
    let output = try #require(device.makeTexture(descriptor: textureDescriptor))
    var gradient = [UInt8](repeating: 0, count: 256 * 256 * 4)
    for y in 0..<256 {
        for x in 0..<256 {
            let offset = (y * 256 + x) * 4
            gradient[offset] = UInt8(x); gradient[offset + 1] = UInt8(y)
            gradient[offset + 2] = UInt8(x); gradient[offset + 3] = 255
        }
    }
    let provider = try #require(CGDataProvider(data: Data(gradient) as CFData))
    let image = try #require(CGImage(width: 256, height: 256, bitsPerComponent: 8,
        bitsPerPixel: 32, bytesPerRow: 256 * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    let snapshot = try #require(SwiftSimReloadRipple.texture(from: image, device: device))
    let queue = try #require(device.makeCommandQueue())
    func render(waveTime: Float) throws -> [UInt8] {
        var uniforms = [SIMD4<Float>](repeating: .zero, count: 14)
        uniforms[0] = SIMD4(256, 256, 0, 0)
        uniforms[1] = SIMD4(0, waveTime, Float(SwiftSimReloadChoreography.waveDuration), 0)
        uniforms[2] = SIMD4(Float(SwiftSimReloadRipple.amplitude), Float(SwiftSimReloadRipple.frequency),
            Float(SwiftSimReloadRipple.decay), 1)
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = output
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        let command = try #require(queue.makeCommandBuffer())
        let encoder = try #require(command.makeRenderCommandEncoder(descriptor: pass))
        encoder.setRenderPipelineState(pipeline)
        uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
        encoder.setFragmentTexture(snapshot, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        command.commit(); command.waitUntilCompleted()
        #expect(command.status == .completed)
        var pixel = [UInt8](repeating: 0, count: 4)
        output.getBytes(&pixel, bytesPerRow: 4, from: MTLRegionMake2D(170, 5, 1, 1), mipmapLevel: 0)
        return pixel
    }
    let before = try render(waveTime: -1)
    #expect(before[3] == 0)
    let touching = try render(waveTime: 0)
    #expect(touching[3] == 0)
    let arrival = Float(hypot(42.5, 0.5) / hypot(128, 251) * (SwiftSimReloadChoreography.waveDuration - 1))
    let crest = try render(waveTime: arrival + 0.08)
    let trough = try render(waveTime: arrival + 0.26)
    #expect(crest[2] > 190) // The source gradient at this pixel is 170.
    #expect(trough[2] < 160)
    #expect(crest[3] > 240 && trough[3] > 240)
    #expect(crest[1] < 50 && trough[1] < 50) // The captured top stays at the top.
    let fading = try render(waveTime: arrival + 0.9)
    let fadingOverHost = Double(fading[2]) + 170 * (1 - Double(fading[3]) / 255)
    #expect(abs(fadingOverHost - 170) < 3) // No displaced duplicate during fade.
    let settled = try render(waveTime: Float(SwiftSimReloadChoreography.waveDuration))
    #expect(settled[3] == 0)
}
#endif
