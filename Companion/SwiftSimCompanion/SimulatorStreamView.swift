import SwiftUI
import UIKit

struct SimulatorStreamView: UIViewRepresentable {
    let url: URL
    let tap: (Double, Double) -> Void
    let gesture: (SimulatorGestureEvent) -> Void
    let frameUpdate: (CGSize) -> Void
    let streamState: (StreamRenderState) -> Void

    func makeUIView(context: Context) -> UIImageView {
        let imageView = UIImageView()
        imageView.backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = true
        imageView.isUserInteractionEnabled = true
        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        let panRecognizer = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        let pinchRecognizer = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePinch(_:)))
        panRecognizer.maximumNumberOfTouches = 1
        panRecognizer.delegate = context.coordinator
        pinchRecognizer.delegate = context.coordinator
        imageView.addGestureRecognizer(tapRecognizer)
        imageView.addGestureRecognizer(panRecognizer)
        imageView.addGestureRecognizer(pinchRecognizer)
        context.coordinator.onTap = tap
        context.coordinator.onGesture = gesture
        context.coordinator.onFrame = frameUpdate
        context.coordinator.onState = streamState
        context.coordinator.start(url: url, imageView: imageView)
        return imageView
    }

    func updateUIView(_ imageView: UIImageView, context: Context) {
        context.coordinator.onTap = tap
        context.coordinator.onGesture = gesture
        context.coordinator.onFrame = frameUpdate
        context.coordinator.onState = streamState
        context.coordinator.start(url: url, imageView: imageView)
    }

    func dismantleUIView(_ imageView: UIImageView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, URLSessionDataDelegate, UIGestureRecognizerDelegate {
        private var imageView: UIImageView?
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var currentURL: URL?
        private var buffer = Data()
        var onTap: ((Double, Double) -> Void)?
        var onGesture: ((SimulatorGestureEvent) -> Void)?
        var onFrame: ((CGSize) -> Void)?
        var onState: ((StreamRenderState) -> Void)?

        func start(url: URL, imageView: UIImageView) {
            self.imageView = imageView
            guard currentURL != url else { return }
            stop()
            currentURL = url
            onState?(.connecting)
            buffer.removeAll(keepingCapacity: true)
            let configuration = URLSessionConfiguration.default
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 20
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            task = session?.dataTask(with: URLRequest(url: url))
            task?.resume()
        }

        func stop() {
            task?.cancel()
            session?.invalidateAndCancel()
            task = nil
            session = nil
            currentURL = nil
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

        @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            guard let (x, y) = normalizedPoint(for: recognizer.location(in: imageView), in: imageView) else { return }
            let type: String
            switch recognizer.state {
            case .began:
                type = "pinch-begin"
            case .changed:
                type = "pinch-move"
            case .ended, .cancelled, .failed:
                type = "pinch-end"
            default:
                return
            }
            onGesture?(
                SimulatorGestureEvent(
                    type: type,
                    x: x,
                    y: y,
                    scale: Double(recognizer.scale),
                    velocity: Double(recognizer.velocity)
                )
            )
            recognizer.scale = 1
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
