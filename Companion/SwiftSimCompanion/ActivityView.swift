import SwiftUI
import UserNotifications

struct ActivityInboxView: View {
    @EnvironmentObject private var activity: ActivityCenter
    @Environment(\.dismiss) private var dismiss
    @State private var showOlderActivity = false

    var body: some View {
        NavigationStack {
            List {
                if let message = activity.errorMessage {
                    Section { Label(message, systemImage: "wifi.exclamationmark").font(.callout) }
                }
                if activity.events.isEmpty {
                    Section {
                        ContentUnavailableView("No activity yet", systemImage: "bell", description: Text("Builds and changes from your Mac appear here."))
                            .listRowBackground(Color.clear)
                    }
                } else {
                    Section("Recent") {
                        ForEach(activity.events.prefix(5)) { event in
                            activityRow(event)
                        }
                    }
                }
                Section {
                    NavigationLink {
                        ActivityNotificationSettingsView(activity: activity, notifications: activity.notifications)
                    } label: {
                        Label("Notifications", systemImage: "bell.badge")
                    }
                    .accessibilityIdentifier("activityNotificationSettingsLink")
                }
                if activity.events.count > 5 {
                    Section {
                        DisclosureGroup(isExpanded: $showOlderActivity) {
                            ForEach(activity.events.dropFirst(5)) { event in
                                activityRow(event)
                            }
                        } label: {
                            Label("Older activity (\(activity.events.count - 5))", systemImage: "clock.arrow.circlepath")
                        }
                        .accessibilityIdentifier("olderActivityDisclosure")
                    }
                }
            }
            .navigationTitle("Activity")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { Button("Mark read") { activity.markAllRead() }.disabled(activity.unreadCount == 0) }
            }
            .refreshable { await activity.refresh(fromBeginning: true) }
            .task { await activity.refresh(fromBeginning: true) }
            .sheet(item: $activity.selectedEvent) { event in
                ActivityEventDetailView(event: event)
            }
        }
    }

    private func activityRow(_ event: ActivityEvent) -> some View {
        Button { Task { await activity.open(event) } } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: event.symbol)
                    .font(.title3)
                    .foregroundStyle(event.isAttention ? .orange : .blue)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.title).font(.headline).foregroundStyle(.primary)
                    Text(event.message).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                    HStack {
                        Text(event.statusLabel)
                        Spacer()
                        if let date = event.date { Text(date, format: .relative(presentation: .named, unitsStyle: .abbreviated)) }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ActivityEventDetailView: View {
    let event: ActivityEvent
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(event.title, systemImage: event.symbol).font(.headline)
                    Text(event.message)
                    LabeledContent("Status", value: event.statusLabel)
                    if let date = event.date { LabeledContent("Updated", value: date.formatted(date: .abbreviated, time: .shortened)) }
                    if let revision = event.revision {
                        DisclosureGroup("Details") { LabeledContent("Revision", value: String(revision)) }
                    }
                }
                if event.canApplyQueuedChange, let url = event.supportedLaunchURL {
                    Section {
                        Button("Open \(event.targetAppName ?? "your app")") { openURL(url) }
                    }
                }
            }
            .navigationTitle("Update")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

private struct ActivityNotificationSettingsView: View {
    @ObservedObject var activity: ActivityCenter
    @ObservedObject var notifications: CompanionNotifications
    @Environment(\.openURL) private var openURL

    private var permissionAllowed: Bool {
        [.authorized, .provisional, .ephemeral].contains(notifications.authorization)
    }

    var body: some View {
        ZStack {
            HomeCanvas()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    availabilityCard
                    VStack(spacing: 14) {
                        Toggle("Changes ready", isOn: preference(\.queued)).frame(minHeight: 44)
                        Divider()
                        Toggle("New build ready", isOn: preference(\.buildReady)).frame(minHeight: 44)
                        Divider()
                        Toggle("Changes applied", isOn: preference(\.hotReload)).frame(minHeight: 44)
                        Divider()
                        Toggle("Needs attention", isOn: preference(\.attention)).frame(minHeight: 44)
                        Divider()
                        Toggle("App opened", isOn: preference(\.launchConfirmed)).frame(minHeight: 44)
                    }
                    .font(.subheadline).padding(20)
                    .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22))
                    DisclosureGroup("Alert details") {
                        VStack(alignment: .leading, spacing: 12) {
                            LabeledContent("iPhone permission", value: permissionAllowed ? "Allowed" : notifications.authorization == .denied ? "Off" : "Not set")
                            LabeledContent("Mac alerts", value: activity.providerStatus.map { $0.configured ? "Available" : "Unavailable" } ?? "Not checked")
                            if let message = notifications.registrationMessage { Text(message) }
                            if let message = notifications.deliveryMessage { Text(message) }
                        }
                        .font(.footnote).foregroundStyle(.secondary).padding(.top, 14)
                    }
                    .font(.subheadline.weight(.medium)).padding(18)
                    .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
                }.padding(20)
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await notifications.refreshAuthorization() }
    }

    private var availabilityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let provider = activity.providerStatus, !provider.configured {
                Label("In-app updates only", systemImage: "bell.slash")
                    .font(.headline)
                Text("Background alerts aren't available from this Mac. Updates still appear in Activity.")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else if activity.providerStatus == nil {
                Label("Connect your Mac", systemImage: "macbook.and.iphone").font(.headline)
                Text("Reconnect to check whether alerts are available.")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else if permissionAllowed {
                Label("Notifications on", systemImage: "checkmark.circle.fill")
                    .font(.headline).foregroundStyle(.green)
            } else if notifications.authorization == .denied {
                Label("Notifications off", systemImage: "bell.slash").font(.headline)
                Button("Open iPhone settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .frame(minHeight: 44)
            } else {
                Button("Enable notifications") { Task { await activity.enableNotifications() } }
                    .font(.headline).frame(minHeight: 44)
                    .accessibilityIdentifier("enableActivityNotificationsButton")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22))
    }

    private func preference(_ path: WritableKeyPath<ActivityPreferences, Bool>) -> Binding<Bool> {
        Binding(get: { activity.preferences[keyPath: path] }, set: { value in
            var next = activity.preferences
            next[keyPath: path] = value
            activity.updatePreferences(next)
        })
    }
}
