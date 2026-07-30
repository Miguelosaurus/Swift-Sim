#import <Foundation/Foundation.h>
#import <objc/runtime.h>

typedef NS_ENUM(NSUInteger, SwiftSimRequestKind) {
    SwiftSimRequestKindNone = 0,
    SwiftSimRequestKindHelperStatus,
    SwiftSimRequestKindSessionDiagnostic,
    SwiftSimRequestKindSessionStatus,
    SwiftSimRequestKindSessionLogs,
    SwiftSimRequestKindSessionStream,
    SwiftSimRequestKindSessionInput,
};

@interface SwiftSimLatestRequestProtocol : NSURLProtocol <NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *forwardingSession;
@property(nonatomic, strong) NSURLSessionDataTask *forwardingTask;
@property(nonatomic, copy) NSString *lane;
@property(nonatomic, copy) NSString *sessionID;
@property(nonatomic) SwiftSimRequestKind requestKind;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) NSUInteger sessionEpoch;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL stopped;
@end

static BOOL SwiftSimDisableLegacyFence(id self, SEL command, NSURLRequest *request) {
    return NO;
}

@implementation SwiftSimLatestRequestProtocol

static NSLock *SwiftSimFenceLock;
static NSMutableDictionary<NSString *, NSNumber *> *SwiftSimFenceGenerations;
static NSString *SwiftSimActiveSessionID;
static NSUInteger SwiftSimActiveSessionEpoch;

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        SwiftSimFenceLock = [[NSLock alloc] init];
        SwiftSimFenceGenerations = [[NSMutableDictionary alloc] init];
        [self replaceLegacyFenceRegistration];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self replaceLegacyFenceRegistration];
            dispatch_async(dispatch_get_main_queue(), ^{
                [self replaceLegacyFenceRegistration];
            });
        });
    });
}

+ (void)replaceLegacyFenceRegistration {
    Class oldFence = NSClassFromString(@"SwiftSimCompanion.SwiftSimRequestFenceProtocol");
    if (oldFence && [oldFence isSubclassOfClass:[NSURLProtocol class]]) {
        Class metaClass = object_getClass(oldFence);
        class_replaceMethod(metaClass, @selector(canInitWithRequest:), (IMP)SwiftSimDisableLegacyFence, "c@:@");
        [NSURLProtocol unregisterClass:oldFence];
    }
    [NSURLProtocol unregisterClass:self];
    [NSURLProtocol registerClass:self];
}

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    if ([request valueForHTTPHeaderField:@"X-Swift-Sim-Latest-Fenced"] != nil) {
        return NO;
    }
    NSString *sessionID = nil;
    SwiftSimRequestKind kind = [self classifyRequest:request sessionID:&sessionID];
    return kind != SwiftSimRequestKindNone;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

+ (BOOL)requestIsCacheEquivalent:(NSURLRequest *)a toRequest:(NSURLRequest *)b {
    return NO;
}

- (void)startLoading {
    NSString *sessionID = nil;
    SwiftSimRequestKind kind = [SwiftSimLatestRequestProtocol classifyRequest:self.request sessionID:&sessionID];
    if (kind == SwiftSimRequestKindNone) {
        [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorUnsupportedURL userInfo:nil]];
        return;
    }
    if (kind == SwiftSimRequestKindSessionStatus && self.request.timeoutInterval <= 10.0) {
        // Connection diagnostics intentionally fan out across saved sessions and
        // must not activate or supersede the visible Simulator.
        kind = SwiftSimRequestKindSessionDiagnostic;
    }
    self.requestKind = kind;
    self.sessionID = sessionID;

    BOOL authorized = YES;
    [SwiftSimFenceLock lock];
    if (kind == SwiftSimRequestKindSessionStatus || kind == SwiftSimRequestKindSessionStream) {
        if (![SwiftSimActiveSessionID isEqualToString:sessionID]) {
            SwiftSimActiveSessionID = [sessionID copy];
            SwiftSimActiveSessionEpoch += 1;
        }
        self.sessionEpoch = SwiftSimActiveSessionEpoch;
    } else if (kind == SwiftSimRequestKindSessionLogs || kind == SwiftSimRequestKindSessionInput) {
        authorized = sessionID.length > 0 && [SwiftSimActiveSessionID isEqualToString:sessionID];
        self.sessionEpoch = SwiftSimActiveSessionEpoch;
    }

    self.lane = [SwiftSimLatestRequestProtocol laneForKind:kind sessionID:sessionID];
    if (self.lane.length > 0) {
        NSUInteger next = [SwiftSimFenceGenerations[self.lane] unsignedIntegerValue] + 1;
        SwiftSimFenceGenerations[self.lane] = @(next);
        self.generation = next;
    }
    [SwiftSimFenceLock unlock];

    if (!authorized) {
        [self finishWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]];
        return;
    }

    NSMutableURLRequest *forwarded = [self.request mutableCopy];
    [forwarded setValue:@"1" forHTTPHeaderField:@"X-Swift-Sim-Latest-Fenced"];
    [forwarded setValue:@"1" forHTTPHeaderField:@"X-Swift-Sim-Fenced"];
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.protocolClasses = @[];
    configuration.URLCache = nil;
    self.forwardingSession = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    self.forwardingTask = [self.forwardingSession dataTaskWithRequest:forwarded];
    [self.forwardingTask resume];
}

- (void)stopLoading {
    @synchronized (self) {
        if (self.stopped) return;
        self.stopped = YES;
        self.completed = YES;
    }
    if (self.requestKind == SwiftSimRequestKindSessionStream) {
        [SwiftSimFenceLock lock];
        if ([SwiftSimActiveSessionID isEqualToString:self.sessionID]
            && SwiftSimActiveSessionEpoch == self.sessionEpoch) {
            SwiftSimActiveSessionID = nil;
            SwiftSimActiveSessionEpoch += 1;
        }
        [SwiftSimFenceLock unlock];
    }
    [self.forwardingTask cancel];
    [self.forwardingSession invalidateAndCancel];
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
 didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler {
    if (![self isAuthoritative]) {
        completionHandler(NSURLSessionResponseCancel);
        [self finishWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]];
        return;
    }
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
    if (![self isAuthoritative]) {
        [self.forwardingTask cancel];
        return;
    }
    if (data.length > 0) [self.client URLProtocol:self didLoadData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 didCompleteWithError:(NSError *)error {
    if (![self isAuthoritative]) {
        [self finishWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]];
        return;
    }
    if (error != nil) [self finishWithError:error];
    else [self finishSuccessfully];
}

- (BOOL)isAuthoritative {
    [SwiftSimFenceLock lock];
    BOOL current = YES;
    if (self.lane.length > 0) {
        current = [SwiftSimFenceGenerations[self.lane] unsignedIntegerValue] == self.generation;
    }
    if (current && self.requestKind >= SwiftSimRequestKindSessionStatus) {
        current = [SwiftSimActiveSessionID isEqualToString:self.sessionID]
            && SwiftSimActiveSessionEpoch == self.sessionEpoch;
    }
    [SwiftSimFenceLock unlock];
    return current;
}

- (void)finishWithError:(NSError *)error {
    @synchronized (self) {
        if (self.completed) return;
        self.completed = YES;
    }
    [self.client URLProtocol:self didFailWithError:error];
    [self.forwardingSession finishTasksAndInvalidate];
}

- (void)finishSuccessfully {
    @synchronized (self) {
        if (self.completed) return;
        self.completed = YES;
    }
    [self.client URLProtocolDidFinishLoading:self];
    [self.forwardingSession finishTasksAndInvalidate];
}

+ (SwiftSimRequestKind)classifyRequest:(NSURLRequest *)request sessionID:(NSString **)sessionID {
    NSString *path = request.URL.path ?: @"";
    NSString *method = request.HTTPMethod.uppercaseString ?: @"GET";
    if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/api/pairing/status"]) {
        return SwiftSimRequestKindHelperStatus;
    }

    NSArray<NSString *> *parts = [path componentsSeparatedByString:@"/"];
    NSMutableArray<NSString *> *segments = [[NSMutableArray alloc] init];
    for (NSString *part in parts) if (part.length > 0) [segments addObject:part];
    if (segments.count < 3 || ![segments[0] isEqualToString:@"api"] || ![segments[1] isEqualToString:@"sessions"]) {
        return SwiftSimRequestKindNone;
    }
    NSString *resolvedID = segments[2];
    if (sessionID != NULL) *sessionID = resolvedID;
    if ([method isEqualToString:@"GET"] && segments.count == 3) return SwiftSimRequestKindSessionStatus;
    if ([method isEqualToString:@"GET"] && segments.count == 4 && [segments[3] isEqualToString:@"logs"]) return SwiftSimRequestKindSessionLogs;
    if ([method isEqualToString:@"GET"] && segments.count == 4 && [segments[3] isEqualToString:@"stream"]) return SwiftSimRequestKindSessionStream;
    if ([method isEqualToString:@"POST"] && segments.count == 4) {
        NSSet<NSString *> *actions = [NSSet setWithArray:@[@"type", @"key", @"tap", @"gesture", @"multitouch"]];
        if ([actions containsObject:segments[3]]) return SwiftSimRequestKindSessionInput;
    }
    if ([method isEqualToString:@"POST"] && segments.count == 5 && [segments[3] isEqualToString:@"control"]) {
        return SwiftSimRequestKindSessionInput;
    }
    return SwiftSimRequestKindNone;
}

+ (NSString *)laneForKind:(SwiftSimRequestKind)kind sessionID:(NSString *)sessionID {
    switch (kind) {
        case SwiftSimRequestKindHelperStatus: return @"helper-status";
        case SwiftSimRequestKindSessionStatus: return [@"simulator-status:" stringByAppendingString:sessionID ?: @""];
        case SwiftSimRequestKindSessionLogs: return [@"simulator-logs:" stringByAppendingString:sessionID ?: @""];
        case SwiftSimRequestKindSessionStream: return [@"simulator-stream:" stringByAppendingString:sessionID ?: @""];
        default: return nil;
    }
}

@end
