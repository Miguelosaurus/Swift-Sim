#import <Foundation/Foundation.h>

@interface SwiftSimLatestRequestProtocol : NSURLProtocol <NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *forwardingSession;
@property(nonatomic, strong) NSURLSessionDataTask *forwardingTask;
@property(nonatomic, copy) NSString *lane;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL completed;
@end

@implementation SwiftSimLatestRequestProtocol

static NSLock *SwiftSimFenceLock;
static NSMutableDictionary<NSString *, NSNumber *> *SwiftSimFenceGenerations;

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        SwiftSimFenceLock = [[NSLock alloc] init];
        SwiftSimFenceGenerations = [[NSMutableDictionary alloc] init];
        dispatch_async(dispatch_get_main_queue(), ^{
            Class oldFence = NSClassFromString(@"SwiftSimCompanion.SwiftSimRequestFenceProtocol");
            if (oldFence && [oldFence isSubclassOfClass:[NSURLProtocol class]]) {
                [NSURLProtocol unregisterClass:oldFence];
            }
            [NSURLProtocol registerClass:self];
        });
    });
}

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    if ([request valueForHTTPHeaderField:@"X-Swift-Sim-Latest-Fenced"] != nil) {
        return NO;
    }
    return [self laneForPath:request.URL.path] != nil;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

+ (BOOL)requestIsCacheEquivalent:(NSURLRequest *)a toRequest:(NSURLRequest *)b {
    return NO;
}

- (void)startLoading {
    NSString *lane = [SwiftSimLatestRequestProtocol laneForPath:self.request.URL.path];
    if (lane == nil) {
        [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorUnsupportedURL userInfo:nil]];
        return;
    }
    self.lane = lane;
    [SwiftSimFenceLock lock];
    NSUInteger next = [SwiftSimFenceGenerations[lane] unsignedIntegerValue] + 1;
    SwiftSimFenceGenerations[lane] = @(next);
    self.generation = next;
    [SwiftSimFenceLock unlock];

    NSMutableURLRequest *forwarded = [self.request mutableCopy];
    [forwarded setValue:@"1" forHTTPHeaderField:@"X-Swift-Sim-Latest-Fenced"];
    [forwarded setValue:@"1" forHTTPHeaderField:@"X-Swift-Sim-Fenced"];
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.protocolClasses = @[];
    self.forwardingSession = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    self.forwardingTask = [self.forwardingSession dataTaskWithRequest:forwarded];
    [self.forwardingTask resume];
}

- (void)stopLoading {
    [self invalidateGenerationIfCurrent];
    [self.forwardingTask cancel];
    [self.forwardingSession invalidateAndCancel];
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
 didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler {
    if (![self isLatest]) {
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
    if (![self isLatest] || data.length == 0) {
        return;
    }
    [self.client URLProtocol:self didLoadData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 didCompleteWithError:(NSError *)error {
    if (![self isLatest]) {
        [self finishWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]];
        return;
    }
    if (error != nil) {
        [self finishWithError:error];
    } else {
        [self finishSuccessfully];
    }
}

- (BOOL)isLatest {
    if (self.lane == nil) {
        return NO;
    }
    [SwiftSimFenceLock lock];
    BOOL latest = [SwiftSimFenceGenerations[self.lane] unsignedIntegerValue] == self.generation;
    [SwiftSimFenceLock unlock];
    return latest;
}

- (void)invalidateGenerationIfCurrent {
    if (self.lane == nil) {
        return;
    }
    [SwiftSimFenceLock lock];
    if ([SwiftSimFenceGenerations[self.lane] unsignedIntegerValue] == self.generation) {
        SwiftSimFenceGenerations[self.lane] = @(self.generation + 1);
    }
    [SwiftSimFenceLock unlock];
}

- (void)finishWithError:(NSError *)error {
    @synchronized (self) {
        if (self.completed) {
            return;
        }
        self.completed = YES;
    }
    [self.client URLProtocol:self didFailWithError:error];
    [self.forwardingSession finishTasksAndInvalidate];
}

- (void)finishSuccessfully {
    @synchronized (self) {
        if (self.completed) {
            return;
        }
        self.completed = YES;
    }
    [self.client URLProtocolDidFinishLoading:self];
    [self.forwardingSession finishTasksAndInvalidate];
}

+ (NSString *)laneForPath:(NSString *)path {
    if ([path isEqualToString:@"/api/pairing/status"]) {
        return @"helper-status";
    }
    NSArray<NSString *> *parts = [path componentsSeparatedByString:@"/"];
    NSMutableArray<NSString *> *segments = [[NSMutableArray alloc] init];
    for (NSString *part in parts) {
        if (part.length > 0) {
            [segments addObject:part];
        }
    }
    if (segments.count == 3 && [segments[0] isEqualToString:@"api"] && [segments[1] isEqualToString:@"sessions"]) {
        return @"simulator-status";
    }
    if (segments.count == 4 && [segments[0] isEqualToString:@"api"] && [segments[1] isEqualToString:@"sessions"] && [segments[3] isEqualToString:@"logs"]) {
        return @"simulator-logs";
    }
    return nil;
}

@end
