# Main integration — 2026-10-29

## Authorization and result boundary

Miguel explicitly requested review and integration of the accumulated work into `main`, with no open PRs remaining, by 2:09 PM Central on 2026-10-29. That instruction supersedes the earlier draft/unmerged execution restriction for this integration. It does not authorize SQLite authority activation, rollback expiry, deletion, or unsupported claims about live-environment proof.

The integration preserves ordinary Git ancestry: previous `origin/main` is `820ff2e2863e06eab908da70229c7991fd85c65c`; reviewed R2 product is `75e58e0b2b5518b5fc4f40e180c5784e044edb14`; legacy compatibility/staging correction is `3e6a65d` above it. The accepted preparation and historical audit heads are merged in `3b6ea70`. No force-push or history replacement is required.

## Reviewed scope

The canonical Phase 2–4 spine contains the earlier reviewed implementation history. Accepted Phase 5–10 preparation is integrated as documentation, fixtures, prototype tooling, and tests only; it does not activate those later production phases. Historical audit documents retain their original verdicts for traceability; the current correction/review findings supersede them for current-state questions.

Independent review of the final legacy compatibility/staging correction found zero P0/P1/P2 issues after default-helper and exact-self-observer fixes. The full local gate and the new `main` push Verify are the final execution evidence; their exact results must be checked from the resulting main commit. Focused preparation integration tests passed 9/9.

## Live environment observations and remaining work

The real installation is an npm link to the developer checkout at version 0.6.1, not an installed Homebrew keg. There is no running Swift Sim helper/service/listener. The real private database already has the accepted v9 migration, applied on 2026-08-16, and remains `legacy`, revision 0, epoch 0. No forced downgrade or artificial v7/v8 migration is appropriate. The invitation file is genuinely absent.

The continuation supports measured helper absence without inventing a PID/journal or starting a migration-capable helper. Optional invitation/session absence is preserved explicitly; present sources still require exact private backups. The staging runner binds installed provenance and performs snapshot/migration/reopen with a query-only callback, without preparing or activating authority.

A private metadata-copy rehearsal imported the actual 24 build records and 8 sessions, verified three exact backups plus one absence witness, and returned the copy to legacy authority. This is rehearsal evidence, not real-root or actual installed-upgrade proof. Private state, bearer data, filesystem inventories and raw evidence are retained locally outside Git. No real package upgrade, service restart, authority transition, artifact cleanup, or legacy deletion was performed in this continuation.

Remaining environment work is an explicitly scoped actual npm-linked-installation to packaged candidate transition and installed service proof, plus real-root staging/reopen evidence. The old literal Homebrew0.6.1 upgrade premise is not applicable to the observed installation. These remain unclaimed pending work under the committed runner/runbook.

## Pull request disposition

Every open PR in the 110-item inventory was compared by exact head ancestry and unique content. Integrated heads have their content and history in this tree. Superseded alternatives are closed without importing obsolete implementations or temporary publisher workflows; their branches and original commits remain recoverable. No code is dropped merely to remove a PR from the list.

Inventory: 110 PRs; 97 integrated heads; 13 superseded/redundant heads.

| PR | Disposition | Exact head |
| --- | --- | --- |
| #26 | Integrated | `f6d5338df4bb392543bb1db7ac9a597e58d040b0` |
| #27 | Integrated | `932241d0b60cbe27aec31db125635bbdec24dc8a` |
| #28 | Integrated | `110b2422ecc5b57fd28bbffaa45762eb518f315b` |
| #29 | Integrated | `4b175a472ca009498e27e43950dfb09bd26c9408` |
| #30 | Integrated | `092ec816b8684f36e3900ed6826eead8d12b29a3` |
| #31 | Integrated | `ecb2e7f926787e24bb73e432c436c6b4b11c4574` |
| #32 | Integrated | `4260dbf58cb04a97b991bdd17ae7152f76dcd442` |
| #33 | Integrated | `f21e344ea18eb0a976630a4ce38cf52bf30a3f47` |
| #34 | Integrated | `2127a7c8542b56ad5dee9cd1abafb1db531bcfcf` |
| #35 | Integrated | `e0bbbe637cf6bb7b826490b27873d09644bee241` |
| #36 | Integrated | `1af1d6d691e5192db663d7436f9051a3c6ef6751` |
| #37 | Integrated | `0569a0661cc5e7f65df38f2a0f838bb68272a399` |
| #38 | Integrated | `9ccb456f9415885c1c7cc8f58c5442c949bf5a1c` |
| #39 | Integrated | `c8f04c54ab67e881a9dc0792f9da51f0a08081a5` |
| #40 | Integrated | `7367fa2574ff8fa88499be7c8b02ece72ff11ffa` |
| #41 | Integrated | `d653b3f9088622319952ed95235217e77f4cc5e8` |
| #44 | Integrated | `0f8e65a1b0aa0f5e6864940c302704a2ad72f9cd` |
| #45 | Integrated | `6781deacb56ad9d6d342d1eb7eebf90ee3b6d3ef` |
| #46 | Integrated | `7443e7e73b490632cde78b09394a914b2f4c51ac` |
| #47 | Integrated | `1364fa1ea570840e779b4f6b65195b3bb4433ac6` |
| #48 | Integrated | `974db19fe779f7e79118dc113ff1ffc8c5c48bcf` |
| #49 | Integrated | `ff962038c2a5345d016fa9edba3e21768b733a40` |
| #50 | Integrated | `bf7830c24a57f5e754268831500915d3bb8fedab` |
| #52 | Integrated | `8ff4ae860be54d44d19c564dd517f030ef044497` |
| #53 | Integrated | `ec1bd4e83fa7abc557da8a4c82c56a4058699a20` |
| #54 | Integrated | `b1fac0df3360fdc68ca76d910e467b8a1f4944d7` |
| #55 | Integrated | `480b0d50ceae0dc08a774a1cd7a2b1c1c02761db` |
| #56 | Integrated | `e680b6f54003686299158c61f6f30d49d5546e19` |
| #57 | Integrated | `f7b6add6d211d82384d9e6d69112d007455d267d` |
| #58 | Integrated | `98081e489c0c795e07e39249eb8b1436bee78c56` |
| #59 | Integrated | `198b6be92e4f7019fa0b6942dfc19a7d252cb127` |
| #60 | Integrated | `9a3be5757f696665b3b93ff8c1d6a1962f24c1aa` |
| #63 | Integrated | `1a05b2e44cc1064e862a5922605cfb3b2ad63489` |
| #66 | Integrated | `4463be4f9b18e7dd29e6ee019251980ffe583949` |
| #72 | Superseded/redundant; preserve branch | `d3e0253ab342db822bf5b49cd21fc411aecf26ca` |
| #74 | Superseded/redundant; preserve branch | `421e079c914f179ab0ddfd71fa561d2da9e42c36` |
| #77 | Integrated | `bbd773972e33dcc5d7e2e7758482aafabb8f318d` |
| #80 | Integrated | `c92668eee8f17c96346279cc75fc0dd9d5492415` |
| #81 | Superseded/redundant; preserve branch | `1a3fb2b6075f212e3a93d12a1f5fd86933d36216` |
| #84 | Integrated | `d28ba88be0e4cef30588f7764b7997d391b62aea` |
| #85 | Superseded/redundant; preserve branch | `ad9dd22721b0f5f99143d1f47fc8d02ff42cd7ce` |
| #87 | Integrated | `b994cfa3d5a4f4a8aa5fe0aa8760a943745b2cb1` |
| #89 | Integrated | `387e69f35dc3e5adec71d30f03fc1983abdf3292` |
| #91 | Integrated | `2b870d1cd6f76f1b822802219d52b7780bd77e3d` |
| #92 | Integrated | `db5d66b84aff7efbda69ee7383abe07424b296bd` |
| #93 | Integrated | `07a8295f0221f1f2007cb1f01c99a5998f371f8a` |
| #94 | Integrated | `94e5686042a570ed06309b6559833bc43a3a299f` |
| #95 | Integrated | `bc55ccdf1af7f9f18c9757ffbefaef63944b7f70` |
| #96 | Integrated | `e8508440459d2f649432e4ce3c02ae84d1997b3a` |
| #97 | Integrated | `026672a1667183e3b70eed5af5a0ebe69c8c6058` |
| #98 | Integrated | `6ba637f968e424538b719081d7564f1690251df0` |
| #99 | Integrated | `49adc9cfa917634bdb206e5ef2d22c9c628c3e09` |
| #100 | Superseded/redundant; preserve branch | `0d731b1e2ec51a0d573184cd16898db7245cbc34` |
| #101 | Integrated | `3848fd04545a2ed16b2e65e94a2d2a0e3eb0dc4d` |
| #102 | Integrated | `a7a513245f1cffd3efc579d6b7233ace6063d177` |
| #103 | Integrated | `c0d566be5380638f948d89c355a04c4a9508b9cb` |
| #104 | Integrated | `d634199df44d4b43e9fb60ed9459ce60fa81bafb` |
| #105 | Integrated | `d7f4a6b452017651771d89c0dcef96f60c0a2648` |
| #106 | Integrated | `5bc3cb05a36100abcb019a6ccd7f704d7e357a99` |
| #107 | Superseded/redundant; preserve branch | `498418d1044931219ef914c8729b0f2221fb2645` |
| #108 | Integrated | `d812213e87cce9f17d718ba29371262e55c11406` |
| #109 | Integrated | `445660eed1673d5a7d563803227650f4d2f437eb` |
| #110 | Integrated | `8f790b65c609a40dc59723496586c453b680fab8` |
| #111 | Integrated | `cf7e914c2f6e791edd06380578a83310417e0400` |
| #112 | Integrated | `588aacc46cd9482fc963c3ada3da709b6bfa0d81` |
| #113 | Superseded/redundant; preserve branch | `1e9020a0d3b83cbf1a0c7609eda3d10557b77303` |
| #114 | Integrated | `c629967876016f5501b9c44ee305bb4baafe95cd` |
| #115 | Integrated | `3190e583c71c320c4c9c9cc4d25becacbd07ff67` |
| #116 | Integrated | `63ceccdc630fc6c6c9d4aba9e3cb397b95c503a6` |
| #117 | Superseded/redundant; preserve branch | `8ff4ce73bd96713ec634b2b3d74f8ea5484ddd2b` |
| #118 | Integrated | `b38e8f0bcc1f4bce746183c101879c1239b285d8` |
| #119 | Integrated | `2fa0130315b18c50dcc5bfe0344dabafa4334bf3` |
| #120 | Integrated | `19547d52881ed70288f270f98c2b48ba9f333238` |
| #121 | Integrated | `fead681a0f9f95e2891c8e89e00b81eb96d4f3af` |
| #122 | Integrated | `5e186af8b2fb60603d6d1a9f76b36fcf99c93f32` |
| #123 | Integrated | `51cef9a560a34eb92eabe63c5c4fd99743a54140` |
| #124 | Integrated | `0be8234583e9c989b1831c9bce5e042b19b3d46c` |
| #125 | Integrated | `3d5795e4adf798ed284ce0cb676b2239a987143a` |
| #126 | Integrated | `ce015a3454a519aa2a9b9aabb59eeafe01ce0434` |
| #127 | Integrated | `3254d184c97ae5be8c5ddedcdaea8419fead05f3` |
| #128 | Integrated | `ea376f9d0ca146749189fda7fc1be28829f09998` |
| #129 | Integrated | `90046c62d0aac445b17a25cfec85d4b915a34e3a` |
| #130 | Integrated | `5313b17d1949ceced7830034c5f46e3ac0581baa` |
| #131 | Superseded/redundant; preserve branch | `b50f1ad2075e436f6f5871b0f91dbd05883774b1` |
| #132 | Integrated | `cf7b1a2cf0d1823a4351f66a206522eedc8d3e58` |
| #133 | Integrated | `5814ddb176916cd6f3a5c0382bdd6e98b60fff85` |
| #134 | Superseded/redundant; preserve branch | `23d615a479e2ee61a5922110f31bdff2f836d70d` |
| #135 | Integrated | `ef368e49712862396a5069f1d84fd1da39f145c7` |
| #136 | Superseded/redundant; preserve branch | `67221251139325797cac898733bf71a9c0d20280` |
| #137 | Superseded/redundant; preserve branch | `6ec311929fdfc3bef5bf90e8936fdc327450ee8f` |
| #138 | Integrated | `4e670281bcda9e443b4fb5b7e3a2f42e379cfa35` |
| #139 | Integrated | `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c` |
| #140 | Integrated | `c8edbb57b94dfb291a7cada84ae6a097408352cc` |
| #141 | Integrated | `41269235243f836a2575de3f306ebb4ca342cad8` |
| #142 | Integrated | `ec7b909199eea5adc62f4114b74463ad7f1d4c05` |
| #143 | Integrated | `32884c768ecd1e048170d4672d4bf407e2d95303` |
| #144 | Integrated | `76f8c67f2a606c1423870884b6a0c1a1f3453b5e` |
| #145 | Integrated | `48d0ec2af9608522ff0e8cdb15a631cec29bb7e8` |
| #146 | Superseded/redundant; preserve branch | `fdcd721cacfe1fa4e51ee06918a74cdf9815493c` |
| #147 | Integrated | `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66` |
| #148 | Integrated | `27902f55910ba06bb65bb7074c62553379f8f1d5` |
| #149 | Integrated | `bde5c1993112678430423ba32e7fb02b9bb5c9a1` |
| #150 | Integrated | `33919377db8809739baa3860c6145d0e8f831407` |
| #151 | Integrated | `f39da9c6bd5c1bfca9b9e4147d2bbc2c1439d4d3` |
| #152 | Integrated | `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e` |
| #153 | Integrated | `273105b347d9068e0ae306a4e7690d85fba8488c` |
| #154 | Integrated | `24c8905c80a02dbacbf507e704142ee816e8aca1` |
| #155 | Integrated | `3c33c838a1f174b336039d8f683728365d6fb26b` |
| #156 | Integrated | `fdd2b72dc1ecc9f93163ca60fcea809cef13c0a5` |
| #158 | Integrated | `75e58e0b2b5518b5fc4f40e180c5784e044edb14` |
