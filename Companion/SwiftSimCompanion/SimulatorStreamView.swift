import SwiftUI
import UIKit
import AVFoundation
import CoreMedia

struct SimulatorStreamView: UIViewRepresentable {
    let url: URL
    let maskURL: URL
    let tap: (Double, Double) -> Void
    let gesture: (SimulatorGestureEvent) -> Void
    let frameUpdate: (CGSize) -> Void
    let streamState: (StreamRenderState) -> Void

    func makeUIView(context: Context) -> MaskedSimulatorImageView {
        let imageView = MaskedSimulatorImageView()
        imageView.backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = true
        imageView.isUserInteractionEnabled = true
        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        let panRecognizer = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        panRecognizer.maximumNumberOfTouches = 1
        panRecognizer.delegate = context.coordinator
        imageView.addGestureRecognizer(tapRecognizer)
        imageView.addGestureRecognizer(panRecognizer)
        context.coordinator.onTap = tap
        context.coordinator.onGesture = gesture
        context.coordinator.onFrame = frameUpdate
        context.coordinator.onState = streamState
        context.coordinator.start(url: url, maskURL: maskURL, imageView: imageView)
        return imageView
    }

    func updateUIView(_ imageView: MaskedSimulatorImageView, context: Context) {
        context.coordinator.onTap = tap
        context.coordinator.onGesture = gesture
        context.coordinator.onFrame = frameUpdate
        context.coordinator.onState = streamState
        context.coordinator.start(url: url, maskURL: maskURL, imageView: imageView)
    }

    func dismantleUIView(_ imageView: MaskedSimulatorImageView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, URLSessionDataDelegate, UIGestureRecognizerDelegate {
        private weak var imageView: MaskedSimulatorImageView?
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var currentURL: URL?
        private var currentMaskURL: URL?
        private var maskTask: URLSessionDataTask?
        private var buffer = Data()
        var onTap: ((Double, Double) -> Void)?
        var onGesture: ((SimulatorGestureEvent) -> Void)?
        var onFrame: ((CGSize) -> Void)?
        var onState: ((StreamRenderState) -> Void)?

        func start(url: URL, maskURL: URL, imageView: MaskedSimulatorImageView) {
            self.imageView = imageView
            guard currentURL != url else {
                loadMask(from: maskURL)
                return
            }
            stop()
            currentURL = url
            loadMask(from: maskURL)
            onState?(.connecting)
            buffer.removeAll(keepingCapacity: true)
            let configuration = URLSessionConfiguration.default
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 7 * 24 * 60 * 60
            configuration.timeoutIntervalForResource = 7 * 24 * 60 * 60
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            var request = URLRequest(url: url)
            request.timeoutInterval = 7 * 24 * 60 * 60
            task = session?.dataTask(with: request)
            task?.resume()
        }

        func stop() {
            task?.cancel()
            maskTask?.cancel()
            session?.invalidateAndCancel()
            task = nil
            session = nil
            currentURL = nil
            currentMaskURL = nil
        }

        private func loadMask(from url: URL) {
            guard currentMaskURL != url else { return }
            currentMaskURL = url
            maskTask?.cancel()
            maskTask = SimulatorFrameMaskLoader.load(from: url) { [weak self] image in
                self?.imageView?.setFrameMask(image)
            }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            buffer.append(data)
            while let imageData = nextJPEGFrame() {
                guard let image = UIImage(data: imageData) else { continue }
                DispatchQueue.main.async { [weak self] in
                    self?.imageView?.image = image
                    self?.onFrame?(image.size)
                    self?.onState?(.streaming)
                }
            }
            if buffer.count > 2_000_000 {
                buffer.removeAll(keepingCapacity: true)
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            guard let error else { return }
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            DispatchQueue.main.async { [weak self] in
                self?.onState?(.failed(error.localizedDescription))
            }
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let (x, y) = normalizedPoint(for: recognizer.location(in: imageView), in: imageView) else { return }
            onTap?(min(max(x, 0), 1), min(max(y, 0), 1))
        }

        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard let (x, y) = normalizedPoint(for: recognizer.location(in: imageView), in: imageView) else { return }
            let type: String
            switch recognizer.state {
            case .began:
                type = "begin"
            case .changed:
                type = "move"
            case .ended, .cancelled, .failed:
                type = "end"
            default:
                return
            }
            onGesture?(SimulatorGestureEvent(type: type, x: x, y: y))
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }

        private func normalizedPoint(for point: CGPoint, in imageView: UIImageView?) -> (Double, Double)? {
            guard let imageView, let image = imageView.image else { return nil }
            let rect = imageRect(for: image, in: imageView.bounds)
            guard rect.contains(point) else { return nil }
            let x = (point.x - rect.minX) / max(rect.width, 1)
            let y = (point.y - rect.minY) / max(rect.height, 1)
            return (Double(min(max(x, 0), 1)), Double(min(max(y, 0), 1)))
        }

        private func nextJPEGFrame() -> Data? {
            guard let start = buffer.firstRange(of: Data([0xff, 0xd8]))?.lowerBound,
                  let endRange = buffer[start...].firstRange(of: Data([0xff, 0xd9])) else {
                return nil
            }
            let end = endRange.upperBound
            let imageData = buffer[start..<end]
            buffer.removeSubrange(0..<end)
            return Data(imageData)
        }

        private func imageRect(for image: UIImage, in bounds: CGRect) -> CGRect {
            let imageSize = image.size
            guard imageSize.width > 0, imageSize.height > 0, bounds.width > 0, bounds.height > 0 else {
                return bounds
            }
            let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
            let width = imageSize.width * scale
            let height = imageSize.height * scale
            return CGRect(
                x: bounds.midX - width / 2,
                y: bounds.midY - height / 2,
                width: width,
                height: height
            )
        }
    }
}

enum StreamRenderState: Equatable {
    case connecting
    case streaming
    case failed(String)
}

struct NativeH264StreamView: UIViewRepresentable {
    let url: URL
    let maskURL: URL
    let tap: (Double, Double) -> Void
    let gesture: (SimulatorGestureEvent) -> Void
    let frameUpdate: (CGSize) -> Void
    let streamState: (StreamRenderState) -> Void

    func makeUIView(context: Context) -> NativeVideoSurfaceView {
        let view = NativeVideoSurfaceView()
        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        let panRecognizer = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        panRecognizer.maximumNumberOfTouches = 1
        panRecognizer.delegate = context.coordinator
        view.addGestureRecognizer(tapRecognizer)
        view.addGestureRecognizer(panRecognizer)
        context.coordinator.configure(
            view: view,
            tap: tap,
            gesture: gesture,
            frameUpdate: frameUpdate,
            streamState: streamState
        )
        context.coordinator.start(url: url, maskURL: maskURL)
        return view
    }

    func updateUIView(_ view: NativeVideoSurfaceView, context: Context) {
        context.coordinator.configure(
            view: view,
            tap: tap,
            gesture: gesture,
            frameUpdate: frameUpdate,
            streamState: streamState
        )
        context.coordinator.start(url: url, maskURL: maskURL)
    }

    func dismantleUIView(_ view: NativeVideoSurfaceView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, URLSessionDataDelegate, UIGestureRecognizerDelegate {
        private weak var view: NativeVideoSurfaceView?
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var currentURL: URL?
        private var currentMaskURL: URL?
        private var maskTask: URLSessionDataTask?
        private var buffer = Data()
        private var formatDescription: CMVideoFormatDescription?
        private var frameIndex: Int64 = 0
        private var videoSize: CGSize?
        private var didRenderVideo = false
        private var pendingSamples: [CMSampleBuffer] = []
        private var drainScheduled = false
        private var reconnectScheduled = false
        private var reconnectAttempts = 0
        private var lastPacketAt = Date.distantPast
        private var watchdog: Timer?
        private var onTap: ((Double, Double) -> Void)?
        private var onGesture: ((SimulatorGestureEvent) -> Void)?
        private var onFrame: ((CGSize) -> Void)?
        private var onState: ((StreamRenderState) -> Void)?

        func configure(
            view: NativeVideoSurfaceView,
            tap: @escaping (Double, Double) -> Void,
            gesture: @escaping (SimulatorGestureEvent) -> Void,
            frameUpdate: @escaping (CGSize) -> Void,
            streamState: @escaping (StreamRenderState) -> Void
        ) {
            self.view = view
            self.onTap = tap
            self.onGesture = gesture
            self.onFrame = frameUpdate
            self.onState = streamState
        }

        func start(url: URL, maskURL: URL) {
            guard currentURL != url else {
                loadMask(from: maskURL)
                return
            }
            stop()
            currentURL = url
            loadMask(from: maskURL)
            beginConnection(to: url, reportConnecting: true)
        }

        private func beginConnection(to url: URL, reportConnecting: Bool) {
            buffer.removeAll(keepingCapacity: true)
            formatDescription = nil
            frameIndex = 0
            didRenderVideo = false
            pendingSamples.removeAll(keepingCapacity: true)
            drainScheduled = false
            lastPacketAt = Date()
            if reportConnecting { onState?(.connecting) }

            let configuration = URLSessionConfiguration.default
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 7 * 24 * 60 * 60
            configuration.timeoutIntervalForResource = 7 * 24 * 60 * 60
            let queue = OperationQueue()
            queue.maxConcurrentOperationCount = 1
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
            var request = URLRequest(url: url)
            request.timeoutInterval = 7 * 24 * 60 * 60
            task = session?.dataTask(with: request)
            task?.resume()
            startWatchdog()
        }

        func stop() {
            watchdog?.invalidate()
            watchdog = nil
            task?.cancel()
            maskTask?.cancel()
            session?.invalidateAndCancel()
            task = nil
            session = nil
            currentURL = nil
            currentMaskURL = nil
            pendingSamples.removeAll()
            drainScheduled = false
            reconnectScheduled = false
            reconnectAttempts = 0
            DispatchQueue.main.async { [weak self] in
                self?.view?.reset()
            }
        }

        private func loadMask(from url: URL) {
            guard currentMaskURL != url else { return }
            currentMaskURL = url
            maskTask?.cancel()
            maskTask = SimulatorFrameMaskLoader.load(from: url) { [weak self] image in
                self?.view?.setFrameMask(image)
            }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            guard session === self.session else { return }
            buffer.append(data)
            DispatchQueue.main.async { [weak self] in self?.lastPacketAt = Date() }
            while let packet = nextPacket() {
                handle(packet)
            }
            if buffer.count > 16_000_000 {
                buffer.removeAll(keepingCapacity: true)
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            guard session === self.session else { return }
            if let error, (error as NSError).code == NSURLErrorCancelled { return }
            DispatchQueue.main.async { [weak self] in
                self?.scheduleReconnect(reason: error?.localizedDescription ?? "Stream ended")
            }
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let point = normalizedPoint(recognizer.location(in: view)) else { return }
            onTap?(point.x, point.y)
        }

        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard let point = normalizedPoint(recognizer.location(in: view)) else { return }
            let type: String
            switch recognizer.state {
            case .began: type = "begin"
            case .changed: type = "move"
            case .ended, .cancelled, .failed: type = "end"
            default: return
            }
            onGesture?(SimulatorGestureEvent(type: type, x: point.x, y: point.y))
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }

        private func handle(_ packet: AVCCPacket) {
            switch packet.tag {
            case 0x01:
                guard let configuration = AVCConfiguration(data: packet.payload) else { return }
                formatDescription = configuration.makeFormatDescription()
                videoSize = formatDescription.map {
                    let dimensions = CMVideoFormatDescriptionGetDimensions($0)
                    return CGSize(width: Int(dimensions.width), height: Int(dimensions.height))
                }
                if let videoSize {
                    DispatchQueue.main.async { [weak self] in self?.onFrame?(videoSize) }
                }
            case 0x02, 0x03:
                guard let formatDescription,
                      let sampleBuffer = makeSampleBuffer(packet.payload, formatDescription: formatDescription) else { return }
                DispatchQueue.main.async { [weak self] in
                    self?.enqueue(sampleBuffer)
                }
            case 0x04:
                guard let image = UIImage(data: packet.payload) else { return }
                DispatchQueue.main.async { [weak self] in
                    self?.view?.showSeed(image)
                    self?.onFrame?(image.size)
                    self?.onState?(.streaming)
                }
            default:
                break
            }
        }

        private func enqueue(_ sampleBuffer: CMSampleBuffer) {
            guard currentURL != nil else { return }
            pendingSamples.append(sampleBuffer)
            if pendingSamples.count > 90 {
                scheduleReconnect(reason: "Decoder fell behind")
                return
            }
            drainSamples()
        }

        private func drainSamples() {
            guard let view, currentURL != nil else { return }
            if view.displayLayer.status == .failed {
                scheduleReconnect(reason: view.displayLayer.error?.localizedDescription ?? "Decoder failed")
                return
            }

            while view.displayLayer.isReadyForMoreMediaData, !pendingSamples.isEmpty {
                view.displayLayer.enqueue(pendingSamples.removeFirst())
                reconnectAttempts = 0
                if !didRenderVideo {
                    didRenderVideo = true
                    view.showVideo()
                }
                onState?(.streaming)
            }

            guard !pendingSamples.isEmpty, !drainScheduled else { return }
            drainScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.012) { [weak self] in
                guard let self else { return }
                drainScheduled = false
                drainSamples()
            }
        }

        private func startWatchdog() {
            watchdog?.invalidate()
            watchdog = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                guard let self, currentURL != nil else { return }
                if Date().timeIntervalSince(lastPacketAt) > 4 {
                    scheduleReconnect(reason: "Stream stalled")
                } else if view?.displayLayer.status == .failed {
                    scheduleReconnect(reason: view?.displayLayer.error?.localizedDescription ?? "Decoder failed")
                }
            }
        }

        private func scheduleReconnect(reason: String) {
            guard !reconnectScheduled, let url = currentURL else { return }
            reconnectScheduled = true
            reconnectAttempts += 1
            if reconnectAttempts > 6 {
                reconnectScheduled = false
                onState?(.failed(reason))
                return
            }

            watchdog?.invalidate()
            task?.cancel()
            session?.invalidateAndCancel()
            task = nil
            session = nil
            pendingSamples.removeAll(keepingCapacity: true)
            drainScheduled = false
            view?.prepareForReconnect()

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                guard let self, currentURL == url else { return }
                reconnectScheduled = false
                beginConnection(to: url, reportConnecting: false)
            }
        }

        private func makeSampleBuffer(_ data: Data, formatDescription: CMVideoFormatDescription) -> CMSampleBuffer? {
            var blockBuffer: CMBlockBuffer?
            guard CMBlockBufferCreateWithMemoryBlock(
                allocator: kCFAllocatorDefault,
                memoryBlock: nil,
                blockLength: data.count,
                blockAllocator: kCFAllocatorDefault,
                customBlockSource: nil,
                offsetToData: 0,
                dataLength: data.count,
                flags: 0,
                blockBufferOut: &blockBuffer
            ) == kCMBlockBufferNoErr,
            let blockBuffer else { return nil }

            let replaceStatus = data.withUnsafeBytes { bytes in
                CMBlockBufferReplaceDataBytes(
                    with: bytes.baseAddress!,
                    blockBuffer: blockBuffer,
                    offsetIntoDestination: 0,
                    dataLength: data.count
                )
            }
            guard replaceStatus == kCMBlockBufferNoErr else { return nil }

            var timing = CMSampleTimingInfo(
                duration: CMTime(value: 1, timescale: 60),
                presentationTimeStamp: CMTime(value: frameIndex, timescale: 60),
                decodeTimeStamp: .invalid
            )
            var sampleSize = data.count
            var sampleBuffer: CMSampleBuffer?
            let status = CMSampleBufferCreateReady(
                allocator: kCFAllocatorDefault,
                dataBuffer: blockBuffer,
                formatDescription: formatDescription,
                sampleCount: 1,
                sampleTimingEntryCount: 1,
                sampleTimingArray: &timing,
                sampleSizeEntryCount: 1,
                sampleSizeArray: &sampleSize,
                sampleBufferOut: &sampleBuffer
            )
            guard status == noErr, let sampleBuffer else { return nil }
            frameIndex += 1

            if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true),
               CFArrayGetCount(attachments) > 0 {
                let dictionary = unsafeBitCast(
                    CFArrayGetValueAtIndex(attachments, 0),
                    to: CFMutableDictionary.self
                )
                CFDictionarySetValue(
                    dictionary,
                    Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                    Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
                )
            }
            return sampleBuffer
        }

        private func nextPacket() -> AVCCPacket? {
            guard buffer.count >= 5 else { return nil }
            let length = Int(buffer.readUInt32(at: 0))
            guard length >= 1 else {
                buffer.removeFirst(4)
                return nil
            }
            guard buffer.count >= 4 + length else { return nil }
            let tagIndex = buffer.index(buffer.startIndex, offsetBy: 4)
            let payloadStart = buffer.index(after: tagIndex)
            let packetEnd = buffer.index(buffer.startIndex, offsetBy: 4 + length)
            let tag = buffer[tagIndex]
            let payload = Data(buffer[payloadStart..<packetEnd])
            buffer.removeSubrange(buffer.startIndex..<packetEnd)
            return AVCCPacket(tag: tag, payload: payload)
        }

        private func normalizedPoint(_ point: CGPoint) -> (x: Double, y: Double)? {
            guard let view else { return nil }
            let size = videoSize ?? view.seedImageView.image?.size ?? .zero
            guard size.width > 0, size.height > 0 else { return nil }
            let scale = min(view.bounds.width / size.width, view.bounds.height / size.height)
            let rect = CGRect(
                x: view.bounds.midX - size.width * scale / 2,
                y: view.bounds.midY - size.height * scale / 2,
                width: size.width * scale,
                height: size.height * scale
            )
            guard rect.contains(point) else { return nil }
            return (
                Double(min(max((point.x - rect.minX) / rect.width, 0), 1)),
                Double(min(max((point.y - rect.minY) / rect.height, 0), 1))
            )
        }
    }
}

final class NativeVideoSurfaceView: UIView {
    let displayLayer = AVSampleBufferDisplayLayer()
    let seedImageView = UIImageView()
    private let frameMaskLayer = CALayer()
    private var frameMask: UIImage?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        clipsToBounds = true
        isUserInteractionEnabled = true
        seedImageView.contentMode = .scaleAspectFit
        seedImageView.clipsToBounds = true
        addSubview(seedImageView)
        displayLayer.videoGravity = .resizeAspect
        layer.addSublayer(displayLayer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        seedImageView.frame = bounds
        displayLayer.frame = bounds
        updateFrameMask()
    }

    func showSeed(_ image: UIImage) {
        seedImageView.image = image
        seedImageView.isHidden = false
    }

    func showVideo() {
        seedImageView.isHidden = true
    }

    func reset() {
        seedImageView.image = nil
        seedImageView.isHidden = false
        displayLayer.flushAndRemoveImage()
    }

    func prepareForReconnect() {
        displayLayer.flushAndRemoveImage()
        seedImageView.isHidden = seedImageView.image == nil
    }

    func setFrameMask(_ image: UIImage?) {
        frameMask = image
        updateFrameMask()
    }

    private func updateFrameMask() {
        guard let frameMask else {
            layer.mask = nil
            return
        }
        let image = frameMask.orientedFor(bounds: bounds)
        frameMaskLayer.frame = bounds
        frameMaskLayer.contents = image.cgImage
        frameMaskLayer.contentsGravity = .resizeAspectFill
        layer.mask = frameMaskLayer
    }
}

final class MaskedSimulatorImageView: UIImageView {
    private let frameMaskLayer = CALayer()
    private var frameMask: UIImage?

    override func layoutSubviews() {
        super.layoutSubviews()
        updateFrameMask()
    }

    func setFrameMask(_ image: UIImage?) {
        frameMask = image
        updateFrameMask()
    }

    private func updateFrameMask() {
        guard let frameMask else {
            layer.mask = nil
            return
        }
        let image = frameMask.orientedFor(bounds: bounds)
        frameMaskLayer.frame = bounds
        frameMaskLayer.contents = image.cgImage
        frameMaskLayer.contentsGravity = .resizeAspectFill
        layer.mask = frameMaskLayer
    }
}

private enum SimulatorFrameMaskLoader {
    private static let cache = NSCache<NSURL, UIImage>()

    static func load(from url: URL, completion: @escaping (UIImage?) -> Void) -> URLSessionDataTask? {
        if let cached = cache.object(forKey: url as NSURL) {
            DispatchQueue.main.async { completion(cached) }
            return nil
        }
        let task = URLSession.shared.dataTask(with: url) { data, response, _ in
            guard let data,
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let image = renderPDF(data) else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            cache.setObject(image, forKey: url as NSURL)
            DispatchQueue.main.async { completion(image) }
        }
        task.resume()
        return task
    }

    private static func renderPDF(_ data: Data) -> UIImage? {
        guard let provider = CGDataProvider(data: data as CFData),
              let document = CGPDFDocument(provider),
              let page = document.page(at: 1) else { return nil }
        let mediaBox = page.getBoxRect(.mediaBox)
        guard mediaBox.width > 0, mediaBox.height > 0 else { return nil }
        let scale = min(1, 1600 / max(mediaBox.width, mediaBox.height))
        let size = CGSize(width: mediaBox.width * scale, height: mediaBox.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            let context = renderer.cgContext
            context.clear(CGRect(origin: .zero, size: size))
            context.translateBy(x: 0, y: size.height)
            context.scaleBy(x: scale, y: -scale)
            context.drawPDFPage(page)
        }
    }
}

private extension UIImage {
    func orientedFor(bounds: CGRect) -> UIImage {
        let boundsIsLandscape = bounds.width > bounds.height
        let imageIsLandscape = size.width > size.height
        guard bounds.width > 0, bounds.height > 0, boundsIsLandscape != imageIsLandscape else { return self }
        guard let cgImage else { return self }
        let oriented = UIImage(cgImage: cgImage, scale: 1, orientation: .right)
        let outputSize = CGSize(width: size.height, height: size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: outputSize, format: format).image { _ in
            oriented.draw(in: CGRect(origin: .zero, size: outputSize))
        }
    }
}

private struct AVCCPacket {
    let tag: UInt8
    let payload: Data
}

private struct AVCConfiguration {
    let sps: Data
    let pps: Data
    let nalUnitHeaderLength: Int32

    init?(data: Data) {
        guard data.count >= 7, data[0] == 1 else { return nil }
        nalUnitHeaderLength = Int32((data[4] & 0x03) + 1)
        let spsCount = Int(data[5] & 0x1f)
        guard spsCount > 0 else { return nil }
        var offset = 6
        guard let sps = data.readLengthPrefixedUInt16(at: &offset) else { return nil }
        for _ in 1..<spsCount {
            guard data.readLengthPrefixedUInt16(at: &offset) != nil else { return nil }
        }
        guard offset < data.count else { return nil }
        let ppsCount = Int(data[offset])
        offset += 1
        guard ppsCount > 0,
              let pps = data.readLengthPrefixedUInt16(at: &offset) else { return nil }
        self.sps = sps
        self.pps = pps
    }

    func makeFormatDescription() -> CMVideoFormatDescription? {
        var description: CMFormatDescription?
        let status = sps.withUnsafeBytes { spsBytes in
            pps.withUnsafeBytes { ppsBytes in
                guard let spsBase = spsBytes.bindMemory(to: UInt8.self).baseAddress,
                      let ppsBase = ppsBytes.bindMemory(to: UInt8.self).baseAddress else {
                    return OSStatus(kCMFormatDescriptionError_InvalidParameter)
                }
                var pointers: [UnsafePointer<UInt8>] = [spsBase, ppsBase]
                var sizes = [sps.count, pps.count]
                return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: kCFAllocatorDefault,
                    parameterSetCount: 2,
                    parameterSetPointers: &pointers,
                    parameterSetSizes: &sizes,
                    nalUnitHeaderLength: nalUnitHeaderLength,
                    formatDescriptionOut: &description
                )
            }
        }
        return status == noErr ? description : nil
    }
}

private extension Data {
    func readUInt32(at offset: Int) -> UInt32 {
        guard count >= offset + 4 else { return 0 }
        let start = index(startIndex, offsetBy: offset)
        let end = index(start, offsetBy: 4)
        return self[start..<end].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    }

    func readLengthPrefixedUInt16(at offset: inout Int) -> Data? {
        guard count >= offset + 2 else { return nil }
        let length = Int(self[offset]) << 8 | Int(self[offset + 1])
        offset += 2
        guard length > 0, count >= offset + length else { return nil }
        let result = Data(self[offset..<(offset + length)])
        offset += length
        return result
    }
}
