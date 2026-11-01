#if DEBUG && canImport(MetalKit)
import SwiftUI
import MetalKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Rendering only. Native receipts and the choreography own completion.
struct SwiftSimReloadRenderInput {
    let frame: SwiftSimReloadChoreography.Frame
    let time: Double
    let cornerRadius: CGFloat
    let lightAppearance: Bool
    let prepareSnapshot: Bool
}

/// Distance-delayed, damped displacement, following Mehta's WWDC-based ripple.
/// The larger amplitude and slower decay make both crest and trough visible.
enum SwiftSimReloadRipple {
    static let amplitude = 44.0
    static let frequency = 18.0
    static let decay = 3.2
    static let trailingDuration = 1.0

    static func texture(from image: CGImage, device: MTLDevice) -> MTLTexture? {
        // Renderer captures can have extended-range or unusual bitmap formats.
        // Normalize once to a bounded, known 8-bit layout before uploading.
        let scale = min(1, sqrt(4_000_000 / Double(image.width * image.height)))
        let width = max(1, Int(Double(image.width) * scale))
        let height = max(1, Int(Double(image.height) * scale))
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let converted = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard converted else { return nil }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm,
            width: width, height: height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = .shaderRead
        guard let texture = device.makeTexture(descriptor: descriptor) else { return nil }
        pixels.withUnsafeBytes {
            texture.replace(region: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0,
                withBytes: $0.baseAddress!, bytesPerRow: width * 4)
        }
        return texture
    }

    static func snapshotScale(size: CGSize, nativeScale: CGFloat) -> CGFloat {
        guard size.width > 0, size.height > 0 else { return 1 }
        return min(2, nativeScale, sqrt(4_000_000 / (size.width * size.height)))
    }
}

// Immutable Metal objects are shared across the compiler task and main actor.
// Each presentation owns its queue, capture and transient drawable resources.
private final class SwiftSimReloadGPUResources: @unchecked Sendable {
    let device: MTLDevice
    let pipeline: MTLRenderPipelineState

    init?() {
        guard let device = MTLCreateSystemDefaultDevice() else { return nil }
        do {
            let library = try device.makeLibrary(source: SwiftSimReloadShader.source, options: nil)
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = library.makeFunction(name: "reloadVertex")
            descriptor.fragmentFunction = library.makeFunction(name: "reloadFragment")
            let color = descriptor.colorAttachments[0]!
            color.pixelFormat = .bgra8Unorm
            color.isBlendingEnabled = true
            color.sourceRGBBlendFactor = .one
            color.destinationRGBBlendFactor = .oneMinusSourceAlpha
            color.sourceAlphaBlendFactor = .one
            color.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
            self.device = device
        } catch {
            NSLog("Swift Sim feedback shader unavailable: %@", String(describing: error))
            return nil
        }
    }
}

@MainActor
private enum SwiftSimReloadGPUCache {
    static let compilation = Task.detached(priority: .userInitiated) { SwiftSimReloadGPUResources() }
}

@MainActor
final class SwiftSimReloadMetalView: MTKView {
    static let isAvailable = MTLCreateSystemDefaultDevice() != nil
    var unavailable: (() -> Void)?
    private var resources: SwiftSimReloadGPUResources?
    private var queue: MTLCommandQueue?
    private var capture: MTLTexture?
    private var emptyTexture: MTLTexture?
    private var captureScheduled = false
    private var captureAttempted = false
    private var compilation: Task<Void, Never>?
    private var input: SwiftSimReloadRenderInput?
    private let inFlight = DispatchSemaphore(value: 2)
    private var uniforms = [SIMD4<Float>](repeating: .zero, count: 14)

    init() {
        super.init(frame: .zero, device: MTLCreateSystemDefaultDevice())
        isPaused = true
        enableSetNeedsDisplay = false
        autoResizeDrawable = false
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        framebufferOnly = true
        #if canImport(UIKit)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        #else
        wantsLayer = true
        layer?.isOpaque = false
        #endif
        compilation = Task { [weak self] in
            let resources = await SwiftSimReloadGPUCache.compilation.value
            guard !Task.isCancelled, let self else { return }
            guard let resources else { self.unavailable?(); return }
            self.resources = resources
            self.device = resources.device
            guard let queue = resources.device.makeCommandQueue(maxCommandBufferCount: 2) else {
                self.unavailable?(); return
            }
            self.queue = queue
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm,
                width: 1, height: 1, mipmapped: false)
            guard let empty = resources.device.makeTexture(descriptor: descriptor) else {
                self.unavailable?(); return
            }
            self.emptyTexture = empty
            var clear: UInt32 = 0
            self.emptyTexture?.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0,
                withBytes: &clear, bytesPerRow: 4)
            self.draw()
        }
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    #if canImport(AppKit) && !canImport(UIKit)
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    #endif

    func update(_ input: SwiftSimReloadRenderInput) {
        self.input = input
        if input.prepareSnapshot && !captureAttempted && !captureScheduled {
            captureScheduled = true
            // Let the refreshed host hierarchy commit before capturing it.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.captureScheduled = false
                guard self.input?.prepareSnapshot == true else { return }
                self.prepareCapture()
            }
        }
        if input.frame.finished { capture = nil }
        let scale = SwiftSimReloadRipple.snapshotScale(size: bounds.size, nativeScale: 2)
        let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        if drawableSize != size { drawableSize = size }
        draw()
    }

    func stop() {
        compilation?.cancel()
        compilation = nil
        input = nil
        unavailable = nil
        capture = nil
        emptyTexture = nil
        queue = nil
        resources = nil
        releaseDrawables()
    }

    override func draw(_ rect: CGRect) {
        guard let input, bounds.width > 0, bounds.height > 0,
              let resources, let queue, let emptyTexture,
              inFlight.wait(timeout: .now()) == .success else { return }
        guard let descriptor = currentRenderPassDescriptor, let drawable = currentDrawable,
              let command = queue.makeCommandBuffer(),
              let encoder = command.makeRenderCommandEncoder(descriptor: descriptor) else {
            inFlight.signal()
            return
        }
        let frame = input.frame
        uniforms[0] = SIMD4(Float(bounds.width), Float(bounds.height), Float(input.cornerRadius), Float(input.time))
        uniforms[1] = SIMD4(Float(frame.auraOpacity), frame.waveStarted ? Float(frame.waveProgress * SwiftSimReloadChoreography.waveDuration) : -1,
            Float(SwiftSimReloadChoreography.waveDuration), input.lightAppearance ? 1 : 0)
        uniforms[2] = SIMD4(Float(SwiftSimReloadRipple.amplitude), Float(SwiftSimReloadRipple.frequency),
            Float(SwiftSimReloadRipple.decay), capture == nil ? 0 : 1)
        // Uniform work belongs once per frame, not in every fragment.
        let time = Float(input.time)
        let burst = exp(-time * 1.6)
        for index in 0..<11 {
            let n = Float(index), phase = n * 2.39996
            let drift = time * (0.24 + 0.018 * n) + burst * sin(time * 4) * 0.4
            uniforms[index + 3] = SIMD4(Float(bounds.width) * (0.5 + 0.46 * sin(drift + phase)),
                Float(bounds.height) * (0.5 + 0.46 * cos(drift * 0.83 + phase * 1.37)), 0, 0)
        }
        encoder.setRenderPipelineState(resources.pipeline)
        uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
        encoder.setFragmentTexture(capture ?? emptyTexture, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        let semaphore = inFlight
        command.addCompletedHandler { _ in semaphore.signal() }
        command.present(drawable)
        command.commit()
    }

    private func prepareCapture() {
        guard !captureAttempted, let device, bounds.width > 0, bounds.height > 0 else { return }
        #if canImport(UIKit)
        guard let window else { return }
        captureAttempted = true
        let format = UIGraphicsImageRendererFormat()
        format.scale = SwiftSimReloadRipple.snapshotScale(size: bounds.size, nativeScale: window.screen.scale)
        format.preferredRange = .standard
        let origin = convert(bounds, to: window).origin
        var complete = false
        let hidden = isHidden
        isHidden = true
        defer { isHidden = hidden }
        let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { _ in
            complete = window.drawHierarchy(in: CGRect(origin: CGPoint(x: -origin.x, y: -origin.y),
                size: window.bounds.size), afterScreenUpdates: true)
        }
        guard complete, let cgImage = image.cgImage else { return }
        #elseif canImport(AppKit)
        guard let root = window?.contentView else { return }
        captureAttempted = true
        let hidden = isHidden
        isHidden = true
        defer { isHidden = hidden }
        let rect = convert(bounds, to: root)
        let scale = SwiftSimReloadRipple.snapshotScale(size: rect.size, nativeScale: window?.backingScaleFactor ?? 1)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
            pixelsWide: max(1, Int(rect.width * scale)), pixelsHigh: max(1, Int(rect.height * scale)),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        bitmap.size = rect.size
        root.cacheDisplay(in: rect, to: bitmap)
        guard let cgImage = bitmap.cgImage else { return }
        #endif
        capture = SwiftSimReloadRipple.texture(from: cgImage, device: device)
    }
}

#if canImport(UIKit)
struct SwiftSimReloadProceduralFeedback: UIViewRepresentable {
    let input: SwiftSimReloadRenderInput
    var onUnavailable: () -> Void
    func makeUIView(context: Context) -> SwiftSimReloadMetalView {
        let view = SwiftSimReloadMetalView()
        view.unavailable = onUnavailable
        return view
    }
    func updateUIView(_ view: SwiftSimReloadMetalView, context: Context) { view.update(input) }
    static func dismantleUIView(_ view: SwiftSimReloadMetalView, coordinator: ()) { view.stop() }
}
#elseif canImport(AppKit)
struct SwiftSimReloadProceduralFeedback: NSViewRepresentable {
    let input: SwiftSimReloadRenderInput
    var onUnavailable: () -> Void
    func makeNSView(context: Context) -> SwiftSimReloadMetalView {
        let view = SwiftSimReloadMetalView()
        view.unavailable = onUnavailable
        return view
    }
    func updateNSView(_ view: SwiftSimReloadMetalView, context: Context) { view.update(input) }
    static func dismantleNSView(_ view: SwiftSimReloadMetalView, coordinator: ()) { view.stop() }
}
#endif

/// Independent implementation of the references' movement principles: moving
/// color anchors, a noise-deformed edge, and distance-delayed damped refraction.
/// Runtime compilation keeps CLI SwiftPM and Xcode on the same Debug-only source.
enum SwiftSimReloadShader {
    static let source = #"""
    #include <metal_stdlib>
    using namespace metal;
    struct Varying { float4 position [[position]]; float2 uv; };
    struct Uniforms { float4 geometry; float4 animation; float4 ripple; float4 anchors[11]; };
    vertex Varying reloadVertex(uint id [[vertex_id]]) {
        float2 p = id == 0 ? float2(-1, -1) : (id == 1 ? float2(3, -1) : float2(-1, 3));
        return {float4(p, 0, 1), float2(p.x * .5 + .5, .5 - p.y * .5)};
    }
    float hash(float2 p) { return fract(sin(dot(p, float2(39.73, 153.91))) * 19273.314); }
    float noise(float2 p) {
        float2 cell = floor(p), f = fract(p), blend = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + float2(1, 0)), blend.x),
                   mix(hash(cell + float2(0, 1)), hash(cell + 1), blend.x), blend.y) * 2 - 1;
    }
    float edgeDistance(float2 p, float2 size, float radius) {
        float2 q = abs(p - size * .5) - (size * .5 - radius);
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }
    fragment float4 reloadFragment(Varying v [[stage_in]], constant Uniforms &u [[buffer(0)]],
                                   texture2d<float> snapshot [[texture(0)]]) {
        float2 size = u.geometry.xy, p = v.uv * size;
        float time = u.geometry.w;
        float edge = edgeDistance(p, size, u.geometry.z);
        if (edge > 0) return float4(0);
        float waveTime = u.animation.y;
        if (edge < -150 && waveTime < 0) return float4(0);
        float4 result = float4(0);
        float3 teal = float3(.0, .48, .43);
        if (u.animation.x > .001 && edge > -150) {
        float burst = exp(-time * 1.6);
        float bounce = 1 + .32 * burst * cos(time * 8.2);
        float2 domain = p / max(size.x, size.y) * 5;
        float field = noise(domain + float2(time * .38, -time * .27));
        field += .45 * noise(domain * 2.3 + float2(-time * .24, time * .33));
        float warped = edge + field * (22 + burst * 28) * bounce;
        float distance = min(abs(edge), abs(warped));
        float core = 1 - smoothstep(2.0, 6.0, distance);
        float mid = (1 - smoothstep(0.0, 18.0, distance)) * .55;
        float bloom = (1 - smoothstep(0.0, 42.0, distance)) * .30;
        float alpha = saturate(core + mid + bloom) * u.animation.x;
        for (int i = 0; i < 11; ++i) {
            float weight = saturate(1 - length(p - u.anchors[i].xy) / (max(size.x, size.y) * .56));
            weight = weight * weight * (3 - 2 * weight);
            float3 color = i % 3 == 0 ? float3(.0, .92, .72) :
                           (i % 3 == 1 ? float3(.38, 1, .88) : float3(.0, .68, .78));
            teal = mix(teal, color, weight * .8);
        }
        float shimmer = .92 + field * .12;
        float3 glow = teal * shimmer * (1 + burst * .22);
        result = float4(glow * alpha, alpha);
        }
        if (waveTime >= 0) {
            float2 radial = p - float2(size.x * .5, 5);
            float distanceFromOrigin = length(radial);
            float travel = length(float2(size.x * .5, size.y - 5));
            float speed = travel / max(.2, u.animation.z - 1.0);
            float age = waveTime - distanceFromOrigin / speed;
            if (age > 0 && age < 1.0) {
                float envelope = exp(-u.ripple.z * age);
                float displacement = u.ripple.x * sin(u.ripple.y * age) * envelope
                    * smoothstep(0.0, .05, age) * (1 - smoothstep(.60, .85, age));
                float2 direction = radial / max(1.0, distanceFromOrigin);
                float2 sampleUV = clamp((p + direction * displacement) / size, float2(0), float2(1));
                constexpr sampler linearSampler(coord::normalized, address::clamp_to_edge, filter::linear);
                float4 sample = snapshot.sample(linearSampler, sampleUV);
                // Return sampled pixels to their original positions before
                // fading them, so a displaced copy never ghosts over live text.
                float waveAlpha = smoothstep(0.0, .02, age) * (1 - smoothstep(.85, 1.0, age));
                float highlight = displacement / u.ripple.x;
                float3 refracted = max(float3(0), sample.rgb + highlight * float3(.10, .15, .14));
                if (u.ripple.w < .5) { refracted = teal; waveAlpha *= .14; }
                else { waveAlpha *= sample.a; }
                float4 wave = float4(refracted * waveAlpha, waveAlpha);
                result = wave + result * (1 - wave.a);
            }
        }
        return result;
    }
    """#
}
#endif
