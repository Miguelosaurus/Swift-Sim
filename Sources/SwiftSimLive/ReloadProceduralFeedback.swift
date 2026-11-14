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
    let state: SwiftSimDeliveryFeedbackState
    let estimatedRemaining: Double
    let cornerRadius: CGFloat
    let lightAppearance: Bool
    let active: Bool
    /// The held pre-edit screen (iOS), bent by the ripple as it is washed away.
    var frozenImage: CGImage? = nil

    /// On iOS the held pre-edit frame and the ripple mask reveal the edit, so
    /// no main-thread window capture (and its dropped frames) is needed.
    var prepareSnapshot: Bool {
        #if os(iOS)
        false
        #else
        state.phase == .refreshed
        #endif
    }
}

/// Distance-delayed, damped displacement, following Mehta's WWDC-based ripple.
/// The larger amplitude and slower decay make both crest and trough visible.
enum SwiftSimReloadRipple {
    static let amplitude = 38.0
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
final class SwiftSimReloadGPUResources: @unchecked Sendable {
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

enum SwiftSimReloadGPU {
    static let isAvailable = MTLCreateSystemDefaultDevice() != nil
}

#if canImport(AppKit) && !canImport(UIKit)
/// macOS draws on the main thread; iOS uses the background renderer below.
@MainActor
final class SwiftSimReloadMetalView: MTKView {
    var unavailable: (() -> Void)?
    var finished: (() -> Void)?
    var waveStarted: (() -> Void)?
    private var waveSignaled = false
    private var rendererReady = false
    private var finishedEmitted = false
    private var visualTimeline = SwiftSimReloadVisualTimeline()
    private var readinessScheduled = false
    private var hasRenderedFrame = false
    private var resources: SwiftSimReloadGPUResources?
    private var queue: MTLCommandQueue?
    private var capture: MTLTexture?
    private var emptyTexture: MTLTexture?
    private var captureScheduled = false
    private var captureAttempted = false
    private var compilation: Task<Void, Never>?
    private var input: SwiftSimReloadRenderInput?
    private let inFlight = DispatchSemaphore(value: 2)
    private var uniforms = [SIMD4<Float>](repeating: .zero, count: 15)

    init() {
        super.init(frame: .zero, device: MTLCreateSystemDefaultDevice())
        isPaused = true
        preferredFramesPerSecond = 60
        enableSetNeedsDisplay = false
        autoResizeDrawable = false
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        framebufferOnly = true
        wantsLayer = true
        layer?.isOpaque = false
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

    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func layout() {
        super.layout()
        if !rendererReady { scheduleCaptureIfNeeded(); draw() }
    }

    func update(_ input: SwiftSimReloadRenderInput) {
        self.input = input
        scheduleCaptureIfNeeded()
        signalReadinessIfPossible()
        isPaused = !rendererReady || !input.active || finishedEmitted
        if !rendererReady && input.active { draw() }
    }

    private func scheduleCaptureIfNeeded() {
        if input?.prepareSnapshot == true && input?.active == true && hasRenderedFrame && !captureAttempted && !captureScheduled {
            captureScheduled = true
            // Let the refreshed host hierarchy commit before capturing it.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.captureScheduled = false
                guard self.input?.prepareSnapshot == true, self.input?.active == true else { return }
                self.prepareCapture()
            }
        }
    }

    func stop() {
        isPaused = true
        compilation?.cancel()
        compilation = nil
        input = nil
        unavailable = nil
        finished = nil
        capture = nil
        emptyTexture = nil
        queue = nil
        resources = nil
        releaseDrawables()
    }

    override func draw(_ rect: CGRect) {
        guard let input, input.active, !finishedEmitted, bounds.width > 0, bounds.height > 0,
              let resources, let queue, let emptyTexture,
              inFlight.wait(timeout: .now()) == .success else { return }
        let scale = SwiftSimReloadRipple.snapshotScale(size: bounds.size, nativeScale: 2)
        let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        if drawableSize != size { drawableSize = size }
        guard let descriptor = currentRenderPassDescriptor, let drawable = currentDrawable,
              let command = queue.makeCommandBuffer(),
              let encoder = command.makeRenderCommandEncoder(descriptor: descriptor) else {
            inFlight.signal()
            return
        }
        let sample = visualTimeline.sampled(at: ProcessInfo.processInfo.systemUptime,
            ready: rendererReady, state: input.state, estimatedRemaining: input.estimatedRemaining)
        visualTimeline = sample.timeline
        let frame = sample.frame
        if frame.waveStarted && !waveSignaled {
            waveSignaled = true
            DispatchQueue.main.async { [weak self] in self?.waveStarted?() }
        }
        SwiftSimReloadShader.fill(&uniforms, size: bounds.size, input: input, frame: frame,
            elapsed: visualTimeline.elapsed, hasCapture: capture != nil)
        encoder.setRenderPipelineState(resources.pipeline)
        uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
        encoder.setFragmentTexture(capture ?? emptyTexture, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        let semaphore = inFlight
        command.addCompletedHandler { _ in semaphore.signal() }
        if !readinessScheduled {
            readinessScheduled = true
            // The visual clock stays at zero until the first drawable and any
            // already-required refreshed capture are ready.
            let notifyReady: @Sendable () -> Void = { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self, self.resources != nil else { return }
                    self.hasRenderedFrame = true
                    self.scheduleCaptureIfNeeded()
                    self.signalReadinessIfPossible()
                }
            }
            // The preparation pass is intentionally transparent. Successful
            // GPU completion warms the surface without consuming visual time.
            command.addCompletedHandler { command in
                if command.status == .completed { notifyReady() }
            }
        }
        command.present(drawable)
        command.commit()
        if frame.finished {
            finishedEmitted = true
            isPaused = true
            capture = nil
            DispatchQueue.main.async { [weak self] in self?.finished?() }
        }
    }

    private func signalReadinessIfPossible() {
        guard !rendererReady, hasRenderedFrame, resources != nil, input?.active == true,
              input?.prepareSnapshot != true || captureAttempted else { return }
        rendererReady = true
        isPaused = false
    }

    private func prepareCapture() {
        guard !captureAttempted, let device, bounds.width > 0, bounds.height > 0 else { return }
        guard let root = window?.contentView else { return }
        captureAttempted = true
        defer { signalReadinessIfPossible() }
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
        capture = SwiftSimReloadRipple.texture(from: cgImage, device: device)
    }
}
#endif

#if canImport(UIKit)
/// Draws the glow on its own display-link thread. Applying a patch and
/// re-rendering SwiftUI both happen on the main thread; neither can stall it.
final class SwiftSimReloadBackgroundRenderer: NSObject, @unchecked Sendable {
    private let lock = NSLock()
    private let metalLayer: CAMetalLayer
    private var input: SwiftSimReloadRenderInput?
    private var size = CGSize.zero
    private var resources: SwiftSimReloadGPUResources?
    private var queue: MTLCommandQueue?
    private var emptyTexture: MTLTexture?
    private var preEditTexture: MTLTexture?
    private var preEditImage: CGImage?
    private var timeline = SwiftSimReloadVisualTimeline()
    private var ready = false, readyScheduled = false, waveSignaled = false, done = false, running = false
    private var uniforms = [SIMD4<Float>](repeating: .zero, count: 15)
    private let inFlight = DispatchSemaphore(value: 2)
    private let finished: @Sendable () -> Void
    private let waveStarted: @Sendable (CFTimeInterval) -> Void

    init(layer: CAMetalLayer, finished: @escaping @Sendable () -> Void, waveStarted: @escaping @Sendable (CFTimeInterval) -> Void) {
        metalLayer = layer; self.finished = finished; self.waveStarted = waveStarted
    }

    func configure(resources: SwiftSimReloadGPUResources, queue: MTLCommandQueue, empty: MTLTexture) {
        lock.withLock { self.resources = resources; self.queue = queue; emptyTexture = empty }
    }

    func update(_ input: SwiftSimReloadRenderInput, size: CGSize) {
        lock.withLock { self.input = input; self.size = size }
    }

    func start() {
        guard lock.withLock({ () -> Bool in defer { running = true }; return !running }) else { return }
        let thread = Thread { [self] in
            let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
            if #available(iOS 15, *) { link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120) }
            link.add(to: .current, forMode: .default)
            while lock.withLock({ running }) {
                autoreleasepool { _ = RunLoop.current.run(mode: .default, before: .distantFuture) }
            }
            link.invalidate()
        }
        thread.name = "SwiftSimReloadRenderer"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    /// The render thread exits on its next display-link tick.
    func stop() { lock.withLock { running = false; input = nil } }

    @objc private func tick(_ link: CADisplayLink) {
        lock.lock()
        guard running, !done, let input, input.active, size.width > 0, size.height > 0,
              let resources, let queue, let emptyTexture, inFlight.wait(timeout: .now()) == .success else { lock.unlock(); return }
        if input.frozenImage !== preEditImage {
            // Uploaded on this thread, well before the ripple needs it.
            preEditImage = input.frozenImage
            preEditTexture = input.frozenImage.flatMap { SwiftSimReloadRipple.texture(from: $0, device: resources.device) }
        }
        let sample = timeline.sampled(at: ProcessInfo.processInfo.systemUptime, ready: ready,
            state: input.state, estimatedRemaining: input.estimatedRemaining)
        timeline = sample.timeline
        let frame = sample.frame
        let texture = preEditTexture ?? emptyTexture
        SwiftSimReloadShader.fill(&uniforms, size: size, input: input, frame: frame, elapsed: timeline.elapsed,
            hasCapture: preEditTexture != nil, preEdit: true)
        let signalWave = frame.waveStarted && !waveSignaled
        if signalWave { waveSignaled = true }
        let firstFrame = !readyScheduled
        readyScheduled = true
        if frame.finished { done = true }
        let values = uniforms
        lock.unlock()

        guard let drawable = metalLayer.nextDrawable(), let command = queue.makeCommandBuffer() else { inFlight.signal(); return }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = drawable.texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
        pass.colorAttachments[0].storeAction = .store
        guard let encoder = command.makeRenderCommandEncoder(descriptor: pass) else { inFlight.signal(); return }
        encoder.setRenderPipelineState(resources.pipeline)
        values.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
        encoder.setFragmentTexture(texture, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        let semaphore = inFlight
        command.addCompletedHandler { [weak self] command in
            semaphore.signal()
            // The visual clock stays at zero until the first drawable is ready.
            if firstFrame && command.status == .completed { self?.lock.withLock { self?.ready = true } }
        }
        command.present(drawable)
        command.commit()
        if signalWave { waveStarted(link.timestamp) }
        if frame.finished { finished() }
    }
}

/// iOS host for the background renderer.
final class SwiftSimReloadLayerView: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var unavailable: (() -> Void)?
    var finished: (() -> Void)?
    var waveStarted: ((CFTimeInterval) -> Void)?
    private var renderer: SwiftSimReloadBackgroundRenderer!
    private var compilation: Task<Void, Never>?
    private var input: SwiftSimReloadRenderInput?

    init() {
        super.init(frame: .zero)
        isOpaque = false; backgroundColor = .clear
        isUserInteractionEnabled = false; accessibilityElementsHidden = true
        let metal = layer as! CAMetalLayer
        metal.pixelFormat = .bgra8Unorm; metal.isOpaque = false; metal.framebufferOnly = true
        metal.maximumDrawableCount = 3
        renderer = SwiftSimReloadBackgroundRenderer(layer: metal,
            finished: { [weak self] in Task { @MainActor in self?.finished?() } },
            waveStarted: { [weak self] time in Task { @MainActor in self?.waveStarted?(time) } })
        compilation = Task { [weak self] in
            let resources = await SwiftSimReloadGPUCache.compilation.value
            guard !Task.isCancelled, let self else { return }
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
            guard let resources, let queue = resources.device.makeCommandQueue(maxCommandBufferCount: 2),
                  let empty = resources.device.makeTexture(descriptor: descriptor) else { self.unavailable?(); return }
            var clear: UInt32 = 0
            empty.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &clear, bytesPerRow: 4)
            metal.device = resources.device
            self.renderer.configure(resources: resources, queue: queue, empty: empty)
            self.renderer.start()
        }
    }
    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = SwiftSimReloadRipple.snapshotScale(size: bounds.size, nativeScale: 2)
        (layer as! CAMetalLayer).drawableSize = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        if let input { renderer.update(input, size: bounds.size) }
    }

    func update(_ input: SwiftSimReloadRenderInput) {
        self.input = input
        renderer.update(input, size: bounds.size)
    }

    func stop() { compilation?.cancel(); renderer.stop() }
}

struct SwiftSimReloadProceduralFeedback: UIViewRepresentable {
    let input: SwiftSimReloadRenderInput
    var onUnavailable: () -> Void
    var onFinished: () -> Void
    var onWaveStart: (CFTimeInterval) -> Void = { _ in }
    func makeUIView(context: Context) -> SwiftSimReloadLayerView {
        let view = SwiftSimReloadLayerView()
        view.unavailable = onUnavailable
        view.finished = onFinished
        view.waveStarted = onWaveStart
        return view
    }
    func updateUIView(_ view: SwiftSimReloadLayerView, context: Context) {
        view.finished = onFinished
        view.waveStarted = onWaveStart
        view.update(input)
    }
    static func dismantleUIView(_ view: SwiftSimReloadLayerView, coordinator: ()) { view.stop() }
}
#elseif canImport(AppKit)
struct SwiftSimReloadProceduralFeedback: NSViewRepresentable {
    let input: SwiftSimReloadRenderInput
    var onUnavailable: () -> Void
    var onFinished: () -> Void
    var onWaveStart: (CFTimeInterval) -> Void = { _ in }
    func makeNSView(context: Context) -> SwiftSimReloadMetalView {
        let view = SwiftSimReloadMetalView()
        view.unavailable = onUnavailable
        view.finished = onFinished
        view.waveStarted = { onWaveStart(CACurrentMediaTime()) }
        return view
    }
    func updateNSView(_ view: SwiftSimReloadMetalView, context: Context) {
        view.finished = onFinished
        view.update(input)
    }
    static func dismantleNSView(_ view: SwiftSimReloadMetalView, coordinator: ()) { view.stop() }
}
#endif

/// Independent implementation of the references' movement principles: moving
/// color anchors, a noise-deformed edge, and distance-delayed damped refraction.
/// Runtime compilation keeps CLI SwiftPM and Xcode on the same Debug-only source.
enum SwiftSimReloadShader {
    static let revealSoftness: Float = 56

    /// Per-frame uniforms, computed once per frame rather than per fragment.
    static func fill(_ uniforms: inout [SIMD4<Float>], size: CGSize, input: SwiftSimReloadRenderInput,
                     frame: SwiftSimReloadChoreography.Frame, elapsed: Double, hasCapture: Bool, preEdit: Bool = false) {
        uniforms[0] = SIMD4(Float(size.width), Float(size.height), Float(input.cornerRadius), Float(elapsed))
        uniforms[1] = SIMD4(Float(frame.auraOpacity), frame.waveStarted ? Float(frame.waveProgress * SwiftSimReloadChoreography.waveDuration) : -1,
            Float(SwiftSimReloadChoreography.waveDuration), input.lightAppearance ? 1 : 0)
        uniforms[2] = SIMD4(Float(SwiftSimReloadRipple.amplitude), Float(SwiftSimReloadRipple.frequency),
            Float(SwiftSimReloadRipple.decay), hasCapture ? (preEdit ? 2 : 1) : 0)
        uniforms[3] = SIMD4(revealProgress(for: frame), revealSoftness, 0, 0)
        let time = Float(elapsed)
        let burst = exp(-time * 1.6)
        for index in 0..<11 {
            let n = Float(index), phase = n * 2.39996
            let drift = time * (0.24 + 0.018 * n) + burst * sin(time * 4) * 0.2
            uniforms[index + 4] = SIMD4(Float(size.width) * (0.5 + 0.46 * sin(drift + phase)),
                Float(size.height) * (0.5 + 0.46 * cos(drift * 0.83 + phase * 1.37)), 0, 0)
        }
    }

    static func revealProgress(for frame: SwiftSimReloadChoreography.Frame) -> Float {
        frame.waveStarted ? 1 : min(Float(1).nextDown, Float(frame.reveal))
    }

    static let source = #"""
    #include <metal_stdlib>
    using namespace metal;
    struct Varying { float4 position [[position]]; float2 uv; };
    struct Uniforms { float4 geometry; float4 animation; float4 ripple; float4 reveal; float4 anchors[11]; };
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
    // Closest perimeter position, clockwise from top center. The same shader
    // draws the light and its soft trailing reveal; no separately updated mask.
    float perimeterPosition(float2 p, float2 size, float r) {
        float arc = r * 1.57079632679;
        float a = size.x * .5 - r, b = size.y - 2 * r, c = size.x - 2 * r;
        float length = 2 * (b + c) + 4 * arc;
        float2 q = abs(p - size * .5) - (size * .5 - r);
        bool right = p.x >= size.x * .5, bottom = p.y >= size.y * .5;
        if (q.x > 0 && q.y > 0) {
            if (right && !bottom) return a + r * atan2(q.x, q.y);
            if (right && bottom) return a + arc + b + r * atan2(q.y, q.x);
            if (!right && bottom) return a + 2 * arc + b + c + r * atan2(q.x, q.y);
            return a + 3 * arc + 2 * b + c + r * atan2(q.y, q.x);
        }
        if (q.y >= q.x) {
            if (bottom) return a + 2 * arc + b + (size.x - r - p.x);
            return right ? p.x - size.x * .5 : length - (size.x * .5 - p.x);
        }
        return right ? a + arc + p.y - r : a + 3 * arc + b + c + size.y - r - p.y;
    }
    float revealOpacity(float2 p, float2 size, float radius, float progress, float softness) {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        float length = 2 * (size.x + size.y - 4 * radius) + 6.28318530718 * radius;
        float behindHead = progress * length - perimeterPosition(p, size, radius);
        // Feather only behind the actual head, never across the waiting gap.
        float feather = min(softness, max(.5, (1 - progress) * length * .5));
        return smoothstep(0.0, feather, behindHead);
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
        float bounce = 1 + .16 * burst * cos(time * 8.2);
        float2 domain = p / max(size.x, size.y) * 5;
        float field = noise(domain + float2(time * .38, -time * .27));
        field += .45 * noise(domain * 2.3 + float2(-time * .24, time * .33));
        float warped = edge + field * (18 + burst * 14) * bounce;
        float distance = min(abs(edge), abs(warped));
        float core = 1 - smoothstep(2.0, 6.0, distance);
        float mid = (1 - smoothstep(0.0, 16.0, distance)) * .55;
        float bloom = (1 - smoothstep(0.0, 34.0, distance)) * .30;
        float alpha = saturate(core + mid + bloom) * u.animation.x
            * revealOpacity(p, size, u.geometry.z, u.reveal.x, u.reveal.y);
        for (int i = 0; i < 11; ++i) {
            float weight = saturate(1 - length(p - u.anchors[i].xy) / (max(size.x, size.y) * .56));
            weight = weight * weight * (3 - 2 * weight);
            float3 color = i % 3 == 0 ? float3(.0, .92, .72) :
                           (i % 3 == 1 ? float3(.38, 1, .88) : float3(.0, .68, .78));
            teal = mix(teal, color, weight * .8);
        }
        float shimmer = .92 + field * .12;
        float3 glow = teal * shimmer * (1 + burst * .10);
        result = float4(glow * alpha, alpha);
        }
        if (waveTime >= 0 && u.reveal.x >= 1) {
            float2 radial = p - float2(size.x * .5, 5);
            float distanceFromOrigin = length(radial);
            float travel = length(float2(size.x * .5, size.y - 5));
            float speed = travel / max(.2, u.animation.z - 1.0);
            float age = waveTime - distanceFromOrigin / speed;
            if (age > 0 && age < 1.0 && u.ripple.w < .5) {
                // No captured image (iOS): a luminous ring rides the front and
                // the held pre-edit frame's mask performs the reveal under it.
                float ring = smoothstep(0.0, .025, age) * (1 - smoothstep(.025, .16, age));
                float fade = 1 - smoothstep(.75, 1.0, waveTime / max(.2, u.animation.z - 1.0));
                float a = ring * .6 * fade;
                result = float4(float3(.0, .92, .72) * a, a) + result * (1 - a);
            } else if (age > 0 && age < 1.0) {
                float envelope = exp(-u.ripple.z * age);
                float displacement = u.ripple.x * sin(u.ripple.y * age) * envelope
                    * (1 - smoothstep(.60, .85, age));
                float2 direction = radial / max(1.0, distanceFromOrigin);
                float2 sampleUV = clamp((p + direction * displacement) / size, float2(0), float2(1));
                constexpr sampler linearSampler(coord::normalized, address::clamp_to_edge, filter::linear);
                float4 sample = snapshot.sample(linearSampler, sampleUV);
                // Return sampled pixels to their original positions before
                // fading them, so a displaced copy never ghosts over live text.
                // A pre-edit image bends at the front and washes away quickly,
                // uncovering the new screen just behind the crest.
                float waveAlpha = u.ripple.w > 1.5 ? 1 - smoothstep(.12, .42, age) : 1 - smoothstep(.85, 1.0, age);
                float highlight = displacement / u.ripple.x;
                float3 refracted = max(float3(0), sample.rgb + highlight * float3(.10, .15, .14));
                waveAlpha *= sample.a;
                float4 wave = float4(refracted * waveAlpha, waveAlpha);
                result = wave + result * (1 - wave.a);
            }
        }
        return result;
    }
    """#
}
#endif
