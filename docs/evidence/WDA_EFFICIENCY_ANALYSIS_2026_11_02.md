# WDA output and latency measurements — November 2, 2026

## Scope

This is an offline analysis of private artifacts from the
[stock WDA physical qualification](WDA_WIRELESS_2026_11_02.md). It does not
compare complete agent workflows, model reasoning, total billed tokens, or
image tokens against regular computer use. The qualification itself kept most
full trees on the Mac and printed selected fields; these raw counts are not a
claim about how many tokens every action actually put into the chat.

No new phone operation was performed for this analysis. A tokenizer was
installed in an ignored task-local Python environment, with its encoding cache
also kept there. No app or runtime dependency changed, and no screenshot or
tree was uploaded to a token-counting service.

## Text representation

Used `tiktoken` with `o200k_base` on two representations of each captured screen:

1. The full JSON response, minified before counting rather than counting the
   artificially enlarged pretty-printed artifact.
2. A candidate text sketch: reference, role, label, differing value, and disabled
   state for selected visible nodes intersecting the screen bounds. Repeated
   control labels were not deduplicated into one control.

| Captured screen | Raw JSON tokens | Candidate sketch tokens | Reduction |
| --- | ---: | ---: | ---: |
| Swift Sim app library | 6,133 | 330 | 94.6% |
| Search with entered text | 11,204 | 220 | 98.0% |
| App build history | 8,357 | 484 | 94.2% |
| Zenics calendar | 19,817 | 311 | 98.4% |

These are exact text counts for that tokenizer and those fixtures, not universal
model token counts. The sketch is deliberately incomplete: it omits visual
appearance, geometry in the presented text, images, many wrappers, and native
metadata. It has no production reference-resolution implementation. Some omitted
information will need to remain retrievable on demand. A production representation
must be tested for task success and ambiguity before claiming equivalent coverage
or end-to-end savings. Visual-layout work still requires image evidence.

The promising direction is a compact Mac-side snapshot plus changes after an
action, using screenshots when the requested task or accessibility gaps require
them. The current data does not justify a numerical saving versus image-based
computer use without a controlled comparison of the same tasks and harness.

## Observed HTTP timings

Private request logs measured elapsed time from before request dispatch through
response parsing. Every request used a fresh HTTP connection on the same Wi-Fi.
The following are functional-trial samples, not a repeatable performance suite:

| Operation | Samples | Median | Maximum |
| --- | ---: | ---: | ---: |
| Screen tree read | 14 | 920 ms | 2,115 ms |
| Semantic element lookup | 14 | 221.5 ms | 454 ms |
| Tap | 8 | 569.5 ms | 1,539 ms |
| Text entry | 2 | 515.5 ms | 519 ms |
| Scroll | 4 | 6,015 ms | 7,396 ms |

These omit model turn time, tool dispatch overhead, runner build/startup, and
different-network latency. The scroll samples include both directions and native
scroll behavior; they do not isolate synthesis, animation, or settling as causes.

## Optimization order

1. Keep native WDA as the stock input backend while proving required remote
   startup and control. Same-Wi-Fi speed is insufficient for the product.
2. Reduce agent-facing output on the Mac; retain reference mapping and omitted
   context locally, with explicit freshness and task-owned lifetime.
3. Return an action result with a bounded UI observation/diff in one tool call.
   Reduce unnecessary model round trips and repeated element lookups, while
   preserving exact-target validation and unknown-dispatch handling.
4. Reuse a connection for an explicit testing session and compare stock gesture
   and settling options in a controlled physical-device test.
5. Fork native WDA only if a measured bottleneck remains and a small maintained
   change materially improves the remote workflow. No fork was made here.

No faster-scroll, incremental-native-query, end-to-end token, or cross-network
performance claim has been qualified by this analysis.
