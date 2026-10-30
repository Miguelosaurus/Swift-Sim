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
                    Section { Label(message, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) }
                }
                if activity.events.isEmpty {
                    Section {
                        ContentUnavailableView("No activity yet", systemImage: "bell", description: Text("Builds, queued edits and confirmed updates from your connected Mac appear here."))
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
            .refreshable { await activity.refresh() }
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
                    Text(event.message).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    HStack {
                        Text(event.statusLabel)
                        Spacer()
                        if let date = event.date { Text(date, style: .relative) }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 5)
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
                    if let revision = event.revision { LabeledContent("Revision", value: String(revision)) }
                }
                if event.canApplyQueuedChange {
                    Section {
                        Text("Open \(event.targetAppName ?? "the matching Debug app") to apply this queued change. This may take a few seconds once it reconnects. No new install is needed.")
                            .foregroundStyle(.secondary)
                        if let url = event.supportedLaunchURL {
                            Button("Open \(event.targetAppName ?? "app")") { openURL(url) }
                        }
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

    var body: some View {
        Form {
            Section {
                if [.authorized, .provisional, .ephemeral].contains(notifications.authorization) {
                    Label("Notifications allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else if notifications.authorization == .denied {
                    Button("Open notification settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                } else {
                    Button("Enable notifications") { Task { await activity.enableNotifications() } }
                        .accessibilityIdentifier("enableActivityNotificationsButton")
                }
                if let message = notifications.registrationMessage { Text(message).font(.footnote).foregroundStyle(.secondary) }
            } footer: {
                Text("Queued edits, build-ready, applied hot reloads and actionable alerts are on by default. You control permission in iPhone Settings.")
            }
            Section {
                Toggle("Hot reload queued", isOn: preference(\.queued))
                Toggle("New build ready", isOn: preference(\.buildReady))
                Toggle("Needs attention", isOn: preference(\.attention))
                Toggle("Hot reload applied", isOn: preference(\.hotReload))
                Toggle("Install confirmed by launch", isOn: preference(\.launchConfirmed))
            } header: { Text("Updates") } footer: {
                Text("Compilation progress and routine reconnects don’t send alerts. While Swift Sim is open, updates appear in the app without an extra notification banner.")
            }
            Section("Mac delivery") {
                if activity.providerStatus?.configured == true {
                    Label("Push sender configured", systemImage: "checkmark.shield")
                    Text("Apple handles remote alerts across networks. Activity and install details still load through your private Mac connection.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Label("Mac setup needed", systemImage: "macbook.and.iphone")
                    Text("Your Mac needs an APNs signing key before it can send alerts. Activity still syncs while Swift Sim is open.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await notifications.refreshAuthorization() }
    }

    private func preference(_ path: WritableKeyPath<ActivityPreferences, Bool>) -> Binding<Bool> {
        Binding(get: { activity.preferences[keyPath: path] }, set: { value in
            var next = activity.preferences
            next[keyPath: path] = value
            activity.updatePreferences(next)
        })
    }
}
