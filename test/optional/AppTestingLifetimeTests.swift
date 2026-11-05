import Foundation
import Dispatch
@main enum LifetimeTests {
 static func main() {
  if CommandLine.arguments.contains("blocked-main") {
   let lifetime = SwiftSimTestingLifetime(seconds: 0.2)
   lifetime.arm { _exit(0) }
   lifetime.arm { _exit(9) } // cannot replace/renew the original deadline
   Thread.sleep(forTimeInterval: 5)
   _exit(8)
  }
  let defaultLifetime = SwiftSimTestingLifetime()
  defaultLifetime.arm { _exit(7) }
  precondition(defaultLifetime.secondsRemaining > 599 && defaultLifetime.secondsRemaining <= 600)
  Thread.sleep(forTimeInterval: 0.05)
  precondition(defaultLifetime.select(minutes: 30))
  precondition(defaultLifetime.durationSeconds == 1800)
  precondition(defaultLifetime.secondsRemaining < 1799.99)
  precondition(!defaultLifetime.select(minutes: 60))
  precondition(!defaultLifetime.select(minutes: 0))
  let remaining = defaultLifetime.secondsRemaining
  Thread.sleep(forTimeInterval: 0.05)
  precondition(defaultLifetime.select(minutes: 30))
  precondition(defaultLifetime.secondsRemaining < remaining)
  defaultLifetime.end()
  precondition(defaultLifetime.secondsRemaining == 0)
  let cancelled = SwiftSimTestingLifetime(seconds: 0.05)
  cancelled.arm { _exit(6) }
  cancelled.end()
  precondition(!cancelled.select(minutes: 60))
  Thread.sleep(forTimeInterval: 0.15)
  print("Default cap, monotonic remaining time and cancellation passed")
 }
}
