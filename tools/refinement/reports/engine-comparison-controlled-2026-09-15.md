# Offline engine comparison

- Synthetic numeric observations only. No text was read or retokenized; language tags do not alter the supplied counts.
- Reference estimates are not physical measurements or calibrated consumer-model claims.
- Operational usage values are compared under each engine's native profile/environment policy. This is not a controlled hardware or region experiment.
- Separate controlled mathematical cases use the same explicit scalar profile, output count, regression/hardware settings and environmental factors in the existing cores. They are offline arithmetic exercises, not product method results or provider measurements.
- Deltas compare displayed scalar values or labeled midpoints, not probability distributions or corresponding physical interval endpoints.
- Unknown water source categories and incompatible scopes remain explicit; no unavailable value is converted to zero.
- Original fallback policy applies after eligible direct mappings and explicit model overrides; it does not forcibly replace every direct result.

EcoLogits is developed by its contributors and is part of CodeCarbon. This tool uses the independent TypeScript port and preserves its source attribution.

[Rincé and Banse (2025), EcoLogits: Evaluating the Environmental Impacts of Generative AI, JOSS 10(111), 7471](https://doi.org/10.21105/joss.07471).

## Comparison overview

19 native-policy numeric cases across 7 explicit method/policy variants, plus 7 controlled mathematical cases. Values below use native operational energy; controlled inputs and results follow separately.

| Case | Original kWh | Configured EcoLogits kWh | Signed delta kWh | Configured selection |
| --- | --- | --- | --- | --- |
| direct-openai | 0.00038900446243755 | 0.0033039537379698425 (midpoint) | 0.0029149492755322925 | direct_mapping |
| direct-anthropic | 0.00038900446243755 | 0.0000555068962805609 (midpoint) | -0.0003334975661569891 | direct_mapping |
| direct-google | 0.00038900446243755 | 0.006687611928410497 (midpoint) | 0.006298607465972947 | direct_mapping |
| unmapped-openai | 0.00038900446243755 | 0.12470825055156486 (midpoint) | 0.12431924608912731 | provider_flagship |
| unknown-model | 0.00038900446243755 | 0.12470825055156486 (midpoint) | 0.12431924608912731 | provider_flagship |
| unknown-underlying-provider | 0.00038900446243755 | 0.00038900446243755 | 0 | original_fallback |
| zero-output | Unavailable | Unavailable | Unavailable | direct_mapping |
| missing-output | Unavailable | Unavailable | Unavailable | direct_mapping |
| unsafe-binary64-count | 7007681408.316837990586978158 | Unavailable | Unavailable | direct_mapping |
| int64-limit | 7175865762116.442101583056708769 | Unavailable | Unavailable | direct_mapping |
| no-execution | Unavailable | Unavailable | Unavailable | direct_mapping |
| numeric-language-en | 0.00007780089248751 | 0.0007283907475939684 (midpoint) | 0.0006505898551064584 | direct_mapping |
| numeric-language-de | 0.00007780089248751 | 0.0007283907475939684 (midpoint) | 0.0006505898551064584 | direct_mapping |
| numeric-language-hi | 0.00007780089248751 | 0.0007283907475939684 (midpoint) | 0.0006505898551064584 | direct_mapping |
| numeric-language-zh | 0.00007780089248751 | 0.0007283907475939684 (midpoint) | 0.0006505898551064584 | direct_mapping |
| numeric-language-mixed | 0.00007780089248751 | 0.0007283907475939684 (midpoint) | 0.0006505898551064584 | direct_mapping |
| inclusive-output-with-thinking | 0.00023340267746253 | 0.002016172242781906 (midpoint) | 0.001782769565319376 | direct_mapping |
| history-response | 0.000248962855960032 | 0.000035789011275808973 (midpoint) | -0.000213173844684223027 | direct_mapping |
| history-prompt | Unavailable | Unavailable | Unavailable | direct_mapping |

## Source manifest

| Input or artifact | SHA256 |
| --- | --- |
| fixture_sha256 | 8efed83d99c25fe4cb29b209a8e827b3fef2ae6bd77c1a3bb5594c757499a13e |
| build_sha256 | 78a726b6aa2b91db054d4d42276d58fcb0d55bc3817c5e55acd6fe2c19000055 |
| mappings_sha256 | 2f5e7efd104bc5d6ca8c59c2f85e4d3259c2a8dd7673f6fab320fe9f66fc380a |
| citation_sha256 | 537d1c9205a09c870eeee1e104988a8a6de9c3f43e319ba55dbe098a5393beaf |
| core_lock_sha256 | f1520d66e1a860cae13c5f612880c1b09b00ddb64d47e29592abbd6137c7ae1b |
| retained_source_manifest_sha256 | 38e0eba65c85c1b8c5afd23325ba200a353fbe403533f9e620bdb7e4177d5073 |
| comparison_sha256 | 2ae4984dbf029a5c8ffb0265220c13e387e41bedfcd2f1e33cd8dbbf94be4f38 |
| controlled_comparison_sha256 | 661115de5638d01e521cd1e7a4888b0e93e5c7a6aa00a68f7511497e9b0d6118 |
| original_text_sha256 | fefd81357782bd5413f683af54d94935646c9da082a99f9b77f48ea7f0706686 |
| original_environment_sha256 | 05cffa87b77f95eb7bbab6c9d19e1743c5a92b786e5241db411de57944ccd4ff |

## Methods and policies

### original

Requested engine: original. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e; hash 6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: provider-flagships-2026-09-14. Complete immutable definition is retained in the JSON report.

### ecologits-configured

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e; hash 6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: provider-flagships-2026-09-14. Complete immutable definition is retained in the JSON report.

### ecologits-original-fallback

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379; hash 81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: provider-flagships-2026-09-14-comparison-original-fallback. Complete immutable definition is retained in the JSON report.

### model-override

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0; hash 0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: comparison-model-override. Complete immutable definition is retained in the JSON report.

### original-model-override

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1; hash d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: comparison-original-model-override. Complete immutable definition is retained in the JSON report.

### unavailable-policy

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1; hash 33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: comparison-unavailable-policy. Complete immutable definition is retained in the JSON report.

### unsupported-video-profile

Requested engine: ecologits. Registry identities:

Original: ecologits-reference-2026-09-10-v1; hash 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9.

EcoLogits: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e; hash 67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e.

Core 0.11.1-port.2; catalog 3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6; source artifact d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0.

Fallback policy: comparison-unsupported-video-profile. Complete immutable definition is retained in the JSON report.

## direct-openai

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: c8fd3b176400ced543f5215d8c76809b28bb9c00ac0eafedc11801f5f955bba8.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: db5960e3ded4f9de5221daf11e74135170ac458a5c3f1d38e275ce7c7c758991; output hash: 1ee4d7c3e2bc98a00bc5ab2158bc4b3bc5af145e388f13b06e03083dbeba40cc.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: ca22c5a829cc86a5b870badd067670f1c0381ef00d17055b36ae521b21a4a0f6; output hash: 40ce73563e2021b1988bf63c0421622d7a16d3d53589530f70f5d40a2c8256bd.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0033039537379698425 (midpoint; 0.0021560153416298436 to 0.004451892134309841) | kWh |
| carbon | 1.2700398168756073 (midpoint; 0.828772297322512 to 1.7113073364287028) | gCO2e |
| water_direct | 0.0015666247307540334 (midpoint; 0.0010223106078228175 to 0.0021109388536852494) | L |
| water_upstream | 0.010348313502695343 (midpoint; 0.006752855651518834 to 0.013943771353871853) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0021560153416298436, 0.004451892134309841] | kWh |
| usage | gwp | [0.000828772297322512, 0.0017113073364287028] | kgCO2eq |
| usage | adpe | [2.124753119176211e-10, 4.3873396983623483e-10] | kgSbeq |
| usage | pe | [0.020888339035846575, 0.04313171175404746] | MJ |
| usage | wcf | [0.0077751662593416515, 0.016054710207557103] | L |
| embodied | gwp | [0.00008206373762376238, 0.00008206373762376238] | kgCO2eq |
| embodied | adpe | [4.5965685609656856e-9, 4.5965685609656856e-9] | kgSbeq |
| embodied | pe | [0.0010384747558659976, 0.0010384747558659976] | MJ |
| total | energy | [0.0021560153416298436, 0.004451892134309841] | kWh |
| total | gwp | [0.0009108360349462743, 0.0017933710740524653] | kgCO2eq |
| total | adpe | [4.809043872883307e-9, 5.03530253080192e-9] | kgSbeq |
| total | pe | [0.021926813791712574, 0.04417018650991346] | MJ |
| total | wcf | [0.0077751662593416515, 0.016054710207557103] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0029149492755322925 | 0.0029149492755322925 | 7.49335690718522962664912254106657633185790944988 | none |
| carbon | 1.120506501514613147 | 1.120506501514613147 | 7.49335690718523238225520127109876074970436844666 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.009129912625894693 | 0.009129912625894693 | 7.49335690718523153151618743114853483842285548522 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: f7808713732c36258728a7ca6802f2fab92cc9293bdb791a13eb83749b78a027; output hash: 136ba06e9be5cd489124a49a539668727f0076b1f91b7430383cb3fff9a0af9a.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0033039537379698425 (midpoint; 0.0021560153416298436 to 0.004451892134309841) | kWh |
| carbon | 1.2700398168756073 (midpoint; 0.828772297322512 to 1.7113073364287028) | gCO2e |
| water_direct | 0.0015666247307540334 (midpoint; 0.0010223106078228175 to 0.0021109388536852494) | L |
| water_upstream | 0.010348313502695343 (midpoint; 0.006752855651518834 to 0.013943771353871853) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0021560153416298436, 0.004451892134309841] | kWh |
| usage | gwp | [0.000828772297322512, 0.0017113073364287028] | kgCO2eq |
| usage | adpe | [2.124753119176211e-10, 4.3873396983623483e-10] | kgSbeq |
| usage | pe | [0.020888339035846575, 0.04313171175404746] | MJ |
| usage | wcf | [0.0077751662593416515, 0.016054710207557103] | L |
| embodied | gwp | [0.00008206373762376238, 0.00008206373762376238] | kgCO2eq |
| embodied | adpe | [4.5965685609656856e-9, 4.5965685609656856e-9] | kgSbeq |
| embodied | pe | [0.0010384747558659976, 0.0010384747558659976] | MJ |
| total | energy | [0.0021560153416298436, 0.004451892134309841] | kWh |
| total | gwp | [0.0009108360349462743, 0.0017933710740524653] | kgCO2eq |
| total | adpe | [4.809043872883307e-9, 5.03530253080192e-9] | kgSbeq |
| total | pe | [0.021926813791712574, 0.04417018650991346] | MJ |
| total | wcf | [0.0077751662593416515, 0.016054710207557103] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0029149492755322925 | 0.0029149492755322925 | 7.49335690718522962664912254106657633185790944988 | none |
| carbon | 1.120506501514613147 | 1.120506501514613147 | 7.49335690718523238225520127109876074970436844666 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.009129912625894693 | 0.009129912625894693 | 7.49335690718523153151618743114853483842285548522 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: b079df5490daa836e07606a4df9cdbc5a61b50e8fc8700a7816ae7228d3a7693; output hash: b5945f7e1edc32b4d5aef20bb9a092ac37a901ea9cb27768bc1673e67c38c6ed.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 2680804572dce7413f92060cedd064f717527ae273032a164131cd1a877a3532; output hash: b281c9e3fbb1bd973c006fef0498375f2cfa94972e0377896af30e9faef8a9c7.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 267e097b7ab7680c8fc23d612e35ad2dd85b822ad539223c308ef9d3ea3d3fa1; output hash: 4e7d162f34dc20eaaf5e4a784a09b91b27202f8ea3a61597bfb3162559a30511.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 4363ae9d0b4c54c1827f0158b39cdd10b683fe479d52b639f97e603e5dcbb1b7; output hash: 3d1db102f32dbcda41a155ca2cc30ea69da0788368d250e8bd68b39b93959ab3.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## direct-anthropic

Numeric fixture: live, claude, observed model claude-haiku-4-5, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: d9394de268cb1ba8c163fc812d5f2c04f751a1b20ad34f3a0eb75daae2e174cf.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 0080e1e6da8c24c2d08fd6a64fba1740362ebd55b8a86529bcf016c6b6065b6c; output hash: 929a0428f741127f1152a1b45eac15805735547aecbcda3834277e34cfa728be.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 0a32224ca431a92ce3d2c1fd9160718e632cd9e1243d5f03c0173ee4e96d90da; output hash: 4c7a4da5363ebdd956307def98ff34443ef7109700cf2d339601dbd7ad59a4e6.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: af56704528f2cca7ba2ac464640770ed5fdd88640a9c5eb6f15559b972d2e66e; output hash: 71ed3d28f1d578a89d0b6e82433b528af447d117bd9a3864d16166c80cb1f341.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 4ad0c027b2d465332062fcbd681a9b230ddb9d678b3943d77c00b518292b2401; output hash: 67f1a9c1a09c6d1421586c60be5072ad8e6bd77d73cdd8b391f99f386022be98.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: 263c5ee3e4daff2023a8453afb0f91692fc2db4712cb5652136e1e3bfff07f26; output hash: 2c2fc8f6aacaa8266df5a306067a7918ddd6581dffaf79863a3751d538fc2b50.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 6aaf17835042ea287f06dbda77816e319048f9c689f73ce54995ff385f3a5165; output hash: f08ccfc5fbff194cc0179dd801e925223a18e5a3a0ed0ba9a4a009b7bc13ac11.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 504cf3c96cb4ad0f7304e0741e89bc8f2f273909e384edc1653af95e91619185; output hash: f0cdae402a98a10c5d402cd316f28c879b2532060c74292747e95dfa8ce1d8b0.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0000555068962805609 (midpoint; 0.000030657623587444283 to 0.00008035616897367751) | kWh |
| carbon | 0.021336850930247613 (midpoint; 0.011784790507013584 to 0.03088891135348164) | gCO2e |
| water_direct | 0.000037036896737802364 (midpoint; 0.00000365641382235574 to 0.00007041737965324898) | L |
| water_upstream | 0.0001738531498403448 (midpoint; 0.00009602274283823423 to 0.00025168355684245533) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| usage | gwp | [0.000011784790507013584, 0.00003088891135348164] | kgCO2eq |
| usage | adpe | [3.0213088045426343e-12, 7.91910045235592e-12] | kgSbeq |
| usage | pe | [0.0002970233203645952, 0.0007785227074845772] | MJ |
| usage | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |
| embodied | gwp | [0.0000012536375007325366, 0.000002507275001465073] | kgCO2eq |
| embodied | adpe | [7.021896503342061e-11, 1.4043793006684122e-10] | kgSbeq |
| embodied | pe | [0.00001586414335021356, 0.00003172828670042712] | MJ |
| total | energy | [0.000030657623587444283, 0.00008035616897367751] | kWh |
| total | gwp | [0.00001303842800774612, 0.000033396186354946716] | kgCO2eq |
| total | adpe | [7.324027383796324e-11, 1.4835703051919715e-10] | kgSbeq |
| total | pe | [0.00031288746371480877, 0.0008102509941850044] | MJ |
| total | wcf | [0.00009967915666058997, 0.0003221009364957043] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.0003334975661569891 | 0.0003334975661569891 | -0.857310386794156978739787858660618197338431834632 | none |
| carbon | -0.12819646443074654 | 0.12819646443074654 | -0.857310386794156894476264011999136743433995257665 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.0010445477269603052 | 0.0010445477269603052 | -0.857310386794156932970933165692194036873414759739 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## direct-google

Numeric fixture: live, gemini, observed model gemini-3-1-pro, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: 67358d03df659bb5ae5c6d447c91ac9838cf52d01e5d45e6e9cf7c04ccf2dd35.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: abbda1671bcb8d3e5e2b2778ce2364df58b2d4f5e0d8188d34f1f0cf5439aafe; output hash: 8dd580bb11fcf1adf0092a41037bb8d68b2128b4f27dd68f9f5a5af81c1d6cbe.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: ab50b0f11d1e1c3ddc91980b359820452bc3253829081a350e65db9e49c3eb13; output hash: f551b66877877d57a3933e71aa02363d603b56466239bf3e225565f43d777f86.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: aa568a0f85b9ac4c4bffe2595b51fec2309ab6147a0c0ff99867563624ca0dc0; output hash: a3ad10fec577e4f614b63930774e95cc165c5a31a6bb0fc2639c9b8002078605.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 580e2c31fc390f8aa1e235ddaafe6b10e925441123d435dfa2118f10c6b5afa9; output hash: 67443fdb8b2dfc88f51975ad84c9984134230f12e23bb333ce0191f1c57514df.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: 7a32e0fd6ca8b3298cd4c4e0fccb8dad8ab3a9cb7d1f0a08c732a2653924358d; output hash: 9038e60737c6b2ecd030db0b83d6d5f021b7ab04e94c73acbe83bf510399c5c2.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 91e5a08f1b62c432d5915fadd9f64b11684c6a5fb42d34da8b40675a03ddd4f9; output hash: 157975c4329e9b92b00891095d4f947ad40b161eb7df9b86964c4cd6e9b4655f.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: direct_mapping; profile google_genai/gemini-3.1-pro-preview.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: c85dd8ab963bfcf6aad993435f6cf50296211a6e573e29d885874d1e1262e10f; output hash: 775f538836e4317dd16fafb88e7b89133c8c040808436bb9be62551cf04c6cd0.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.006687611928410497 (midpoint; 0.004304273162676024 to 0.00907095069414497) | kWh |
| carbon | 2.570718025280995 (midpoint; 1.6545626037326635 to 3.4868734468293265) | gCO2e |
| water_direct | 0.006129288363745033 (midpoint; 0.003944925586709494 to 0.008313651140780573) | L |
| water_upstream | 0.020946269320974514 (midpoint; 0.013481413972817574 to 0.028411124669131455) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| usage | gwp | [0.0016545626037326635, 0.0034868734468293267] | kgCO2eq |
| usage | adpe | [4.2418612018172217e-10, 8.939421909079869e-10] | kgSbeq |
| usage | pe | [0.04170152010927038, 0.08788299870515412] | MJ |
| usage | wcf | [0.017426339559527066, 0.03672477580991203] | L |
| embodied | gwp | [0.00011634703196347033, 0.00011634703196347033] | kgCO2eq |
| embodied | adpe | [6.51685049658403e-9, 6.51685049658403e-9] | kgSbeq |
| embodied | pe | [0.0014723123649075986, 0.0014723123649075986] | MJ |
| total | energy | [0.004304273162676024, 0.00907095069414497] | kWh |
| total | gwp | [0.001770909635696134, 0.003603220478792797] | kgCO2eq |
| total | adpe | [6.9410366167657524e-9, 7.410792687492017e-9] | kgSbeq |
| total | pe | [0.043173832474177984, 0.08935531107006171] | MJ |
| total | wcf | [0.017426339559527066, 0.03672477580991203] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.006298607465972947 | 0.006298607465972947 | 16.1916072286294475900206646138327796307320178568 | none |
| carbon | 2.421184709920000847 | 2.421184709920000847 | 16.1916072286294549799302753949408413419216346181 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.019727868444173864 | 0.019727868444173864 | 16.1916072286294496002954541355101952884706906122 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## unmapped-openai

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-6-pro, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: 81532fe1b3fd91cb33029c646bb588daad5f85a8a48d96278ab11a59bd10457a.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 2523474b9e4009a100b13dda4171c73a8eeb685ed08c77748fb5c78f818dfdd4; output hash: f6a095f962e1e7dbd8ce7804b881ff02c74644957dbcea8eefa6960df8a7f29a.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 15d473c1e0a54319776e32a65d9936dbfae529e724e1f4f7b19755180d41bccd; output hash: 86be016e536d1a5c792526926aaa2b5e9676760e973e41c19c1e862c7e9b805e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 0fdfbb4868d14339a68342e2bf2d43f0ccb7a0c2ef38f6c3d0b1c1a9ba258713; output hash: 732c5b017bccce8d27a740d261ef2ed3744f43a9e35e8c2cd01cfb509b2cf2a4.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 7993e719a953fc656ec22fef802d835a63e1c8bb7755ce7279263a131198b5b7; output hash: 0e60dde96a1475c9b4fb144cf4bc79b9253e7c0afe5c44b2313610a72fc11e5f.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: 33bde30196bac8af37ceaf29f88726c85e37c1a538a669bc36c52a667fb83df5; output hash: e74cea3bdc7449b73d90d1d628dd0f093265fac11dbda08f1aff2ca97f2651ad.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 9ee138c46d2a4872b27c2e9f45f0edcc3a223946f2ef1ba091b4d6c120b522b4; output hash: b28892a4327b7f9e2805814a832141543c2b323825813bf0cdaab1fcf4932cfd.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 0b9ccdf29aff908f97e61c32f229adba9464bf037c6fc3a33cb0c1bd75b05b97; output hash: e760b2c805d3d35128b1eb339eb922861367d96c120a158d8dc6436041fd8036.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## unknown-model

Numeric fixture: live, chatgpt, observed model unknown, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: 9e9f4341c123ada452e17ca249b2fad1278518135eb024d3d125171f42955347.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 1e5f2a0bd64fe55715624e5d6dd4e3a835e7c475a87a4c07934cd10b6722ad73; output hash: d51a08fa98e528dbec4ab1dc824caf3e5a542212dc55a95e8405954e5de085c9.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 9b86c5d29503a6d8a31235122b30541a43b78bb04d4a2c0ee073c6991031fd24; output hash: 52a95e61a8532ce0534b1fdf58053784c6e03c057b6c899f3804d6695ae587d6.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: eebdefe1634d514434d45adfc8a0d3b8f910f2a6989cdb9e35588bfef81e3f20; output hash: 7eef8456a84497d4c114d7f92b094dcf2d2e489c5c10ab9ea6efe6f18781e78c.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 16d8385bafa5c79dad805cd076acbed9879e49e1778e3ef1f37db3c4d4b61b14; output hash: fc88c2860a15000a3a11cc89a5fc2748689d3b6b87e12096454f616ec9f62978.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: a717a480f43f8f160273bbe31c44e0669e85a988d10dc3ac3115caed2939c6f5; output hash: c1b3614029aa101e61a4c6ff9933e9e95aff19a3361b344d331b485527368001.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 2056055448293c8b413ed84d01513c68a28a58b2cbfb8404082d6f17bb159da6; output hash: 75e2adf95550a9fb9251d8a84a3b2150dbfabd8d5050a8a5227e2960e478b58d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_policy) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: provider_flagship; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 396b8d175be52e59174805baa0d4972566dce1c698cf27a55c7501460d36a310; output hash: 345489a868bfe5fbecf10af9be2322e73837929021fc54ac5ad2cd7fa44e51cf.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.12470825055156486 (midpoint; 0.06960720752724495 to 0.17980929357588477) | kWh |
| carbon | 47.93785151202153 (midpoint; 26.757010573472957 to 69.11869245057011) | gCO2e |
| water_direct | 0.059132495469867 (midpoint; 0.033005417569168645 to 0.08525957337056536) | L |
| water_upstream | 0.3905987115525563 (midpoint; 0.2180167346960839 to 0.5631806884090287) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| usage | gwp | [0.026757010573472958, 0.0691186924505701] | kgCO2eq |
| usage | adpe | [6.8597903018099895e-9, 1.7720205881903446e-8] | kgSbeq |
| usage | pe | [0.6743824694069599, 1.7420643598806018] | MJ |
| usage | wcf | [0.25102215226525254, 0.648440261779594] | L |
| embodied | gwp | [0.0033650925925925927, 0.0033650925925925927] | kgCO2eq |
| embodied | adpe | [1.884861604374542e-7, 1.884861604374542e-7] | kgSbeq |
| embodied | pe | [0.042583530920570496, 0.042583530920570496] | MJ |
| total | energy | [0.06960720752724495, 0.17980929357588477] | kWh |
| total | gwp | [0.03012210316606555, 0.07248378504316269] | kgCO2eq |
| total | adpe | [1.953459507392642e-7, 2.0620636631935764e-7] | kgSbeq |
| total | pe | [0.7169660003275304, 1.7846478908011723] | MJ |
| total | wcf | [0.25102215226525254, 0.648440261779594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.12431924608912731 | 0.12431924608912731 | 319.583084754677521579664683724932999961721688084 | none |
| carbon | 47.788318196660535847 | 47.788318196660535847 | 319.583084754677650614900958547223401623624659355 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.38938031067575565 | 0.38938031067575565 | 319.583084754677616623091927464045461073611376484 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## unknown-underlying-provider

Numeric fixture: live, perplexity, observed model perplexity-best, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: 1cbca16332411ba416983b464ac81f94b4a9cc03570d7b8268ad63a2421837a8.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 624a25ac35f6f792900cf8172fff72248c31dcdc6efe6b2d52a20aa83ee213fe; output hash: 94bb790f8bc213a24b3701e6c07eff787f9e7762d17740ac0b5bb0647ec14680.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: c19f4554b437b51401f76e4bc64e22f0d1e87dc87f4d5d8c13c33866bfbee88e; output hash: aeee67b4564519e3d93fca8f0d153fa00d837c9610cc67d345201eb9f1397224.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 6607ab1aae465d194526e89a053dcbdfb0ec88e405ee0b41efab0dfdd5032ea6; output hash: 378677bed68d44c9658041794354acb71f7b60439f4be46d4157b8edc567ced4.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: cd8c220d11a61c9850b2b66e947951bb43346912cb1d22df7d10d07a25f1dec2; output hash: 6939f4ebc570d8ebf5cd14a51a53315e1e20148f8723ca67d35565f94508e475.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 36db6390d30c10a58eb0295a15d73156c00f0e632e7f10d276f8b18578a5bc6d; output hash: b63ce8b1643f7c6368fd052bdd7496564d16beb684fd4b4649bccb578f7ee9df.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 1914a0ce1d6ab47aa16fa0dc85c9054d861b67a6d212abe753b246705e3b10f0; output hash: 4a0ed7472391c5a95213eaf308df3a7b11299e00593b8de418ba4d36d8c409a4.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, provider_unknown) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 63955eb3cba91713d13e3a4a4330994cebc8540108800315c3fe8fc9e4931ce4; output hash: d7f99d99c79538c148d83cfd9edb491c3654e2c0c4e455498c7aba2050b52754.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00038900446243755 | kWh |
| carbon | 0.149533315360994153 | gCO2e |
| water_direct | 0.000356527943096433 | L |
| water_upstream | 0.00121840087680065 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## zero-output

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 0; output total unknown; visible thinking unknown.

Observation hash: 019856a51c78ac99ae5ec1b88b27648360126e8be4df93a6b296bbc872682110.

### original

Status: unavailable. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 8e469e86f200030b3940804a37efa99365ec1d4ac9a64e66d1df90b70bcee2d6; output hash: 440c93808aab72aee575285e5075630c11ca4654f13680e6ffec6f16e099b026.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 7b0440d8498289dd7ef18ebc30a828e59c3d16b31f6056bd6d4308f2f52bdc92; output hash: 373e156dabf264fa0f2bc8855deaf3b92ce4ae3ad06c4ae7a244856c09a90d4d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 7e1b06b2972d0b694bc17f90797b2f86590da15727dcb4514a4bc91e999dbe7e; output hash: d33d1f3607dc20560224136eccaca6d4d3ba87b7943460c446f19f0acba0fa73.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: f313c05791b69bfd32331399bc6f79a2127b2261d918296f01a625d9427c0f0a; output hash: 3fb9445dcafc3f1d427464ace3f0b0eae3ad247523558aeadc9503a53e438db9.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: unavailable. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: d034a409839430e68dc931cb89164779a8535abb5163f0da531e0f257973ecc8; output hash: 83a7166bb52463ae83a1bc069e9a37829335b492603d4f82a6e1f09dae79df7c.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 4b2c13bd4e8305765d10ae5b920674d415e91578bc082b3d3d9365deb18d8694; output hash: 9cba0bf792cc912b7eb687916929e1b0e04df830e35dd54fc1f9970d72f8b813.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: fafe63c02635b0836f236f2493eab5a21dd430d52eb9f0130ee35dcbc43773d2; output hash: 76ed22064097dcce19d7fa445d5628994745c29e0c1ca43ddbdb1c100b6b5763.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## missing-output

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer unknown; output total unknown; visible thinking unknown.

Observation hash: baa55c9905b75c059e4a7d881becf92da4b8f1066fd66ac2b23ce421c5c4082a.

### original

Status: unavailable. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: c18160d74c7fa53fb337738b980294e09a51df03b083416c4fb3d989eb96f16c; output hash: 0dd397a36507a1b463e2f013c20975cdbe6f9c738a653d643825e593b1c7c16e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 1f0440413417eb3bfbdb482cfbe91cd9c6171d7ac04186174d564bb91fb5d895; output hash: 8e838cb5b0af4b2895acc328eb100f3db3d5c972566c7d4428117d4f3e5fe8b8.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 657faeb7bc436a0a8fcf0b67304a806a35230ecca8815940fd697225ae59645b; output hash: 9f2356bef3f3f47296348efd2319d43fe8a14a618a4946a514dbeabe8d414e8e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: e21ffdc523f0719e053dc71ad3166b6f1145b5e39959e27d37a30cefc8ae5a6d; output hash: d371b0a34c9e022a1265597e30c5e8ccf24d797fc42527801a44c6e4dbc74ee8.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, estimate_unavailable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: unavailable. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 32f5af9a8e00efb84bfd15d03287cd5d890619770a3033c465553656ea2cffc5; output hash: 8a26c7ec7ce2e94091ddb4c80e026a482fede7c8b97de0aa2ab5db5f20729dd3.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: e2905a4a8b2f0911d70cb8fa0ee65d0b1ab224cfeb469e698e0cfde33d55243c; output hash: f02cfe505091bdc6f794ee14c61edb9d1258b61428864986df4071133c829803.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 5310597506cfdbea8ddbc6a7efa6d925f329a6e901c83684b9019b8521ceffd9; output hash: b1b233e029f39ef6f1a63ff199847713f932860d70f8f9e9832f4d84afe77e41.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## unsafe-binary64-count

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 9007199254740992; output total unknown; visible thinking unknown.

Observation hash: 17d26ba62e6d0125c1ef924bc66896bf7845e71a85e5e5eec14eb79e4f2c9de9.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 77f2b88d9d46beeed0eeef69054bfba2145be07241f74cda57ca1653d7b018b0; output hash: 2b3d2fe6474ac80248e697a008256459b527a9c8b9ec7d7da710473ba26d5eb8.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 7007681408.316837990586978158 | kWh |
| carbon | 2693752733356.99252358163440388 | gCO2e |
| water_direct | 6422636446.705065277611368055 | L |
| water_upstream | 21948758938.989168270317474288 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: d7fb040787c6dd76b3ff7395d46579c2ff470439373ea2429dc17a98bfe25d50; output hash: 1782957bc09ac67c568252ef0f656c18c896cbf1a08937c3aec3998fa53dcc77.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 37e2c51a04e9fa2b2d354c2cb43545586612bfe98ae922e3691c834c924ed8dc; output hash: fbf1373c9d18630643b9e0406812b05cd050cb863380c85f0b7862efbfb87c8d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: f487dc318f313e570a99a19177c1aeeab10e163224c0d224b600d3028d765d07; output hash: 78ca0b36b76ad210d34e5163c09febfd08d55a44d130ddc2e58eb9ba412f047e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 0711de1abdf923bcc685534f6269d63dc6f367edc3e5a7402b69a12c5169fcd2; output hash: e84616ed162e51b70a710d75ce0618ce7a830b20bf733f38e94edae0ffafee87.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 7007681408.316837990586978158 | kWh |
| carbon | 2693752733356.99252358163440388 | gCO2e |
| water_direct | 6422636446.705065277611368055 | L |
| water_upstream | 21948758938.989168270317474288 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: a5ca94b50675c97b5abe6f431e7d73392228254afa7b601e06f81993f7ccd862; output hash: ecd82a7fe91e1393326aa28e914928304ae74e8e39e79ce5ea390707b364fa69.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 555fe740ee467b6457cdce867bd6fabcb8a287d1368c70b76222c1080deb4256; output hash: e6d539aed050495b36506a4608a171fa2bcee8a8ed89831b1184035c0cc95f81.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## int64-limit

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 9223372036854775807; output total unknown; visible thinking unknown.

Observation hash: a4ce007cd428fefaba444d1cc52f5df86b31af4eb3db74666250a7d65b27d64e.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: e163379589cfeb59d54ef460e5bcf08b9b451d2621272135173e5c1843a3bd24; output hash: b61cebe7f7cb2dd151ce002ba0bc5621ce67f665de245e55531dad8489e44df6.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 7175865762116.442101583056708769 | kWh |
| carbon | 2758402798957560.343848526998850684 | gCO2e |
| water_direct | 6576779721425.98684356098500189 | L |
| water_upstream | 22475529153524.908306368291917534 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: f32ef0b31b7febd9c0bbd8eade34cab6a818e8a50f9880e3cad37b2982b30c4f; output hash: fb773a6746f72f748ae60b838e4a4460bd3845fdeff8ebf3b0d751a145b8d004.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 39b4b27798dedc9a748ced93ba4c8ca0aaff46c9315c74e3735165c99c12a9f6; output hash: 9f8dfcc3dfa1c57bacbb1630d51fad16f6ffa8161573ced8afe9009227c799c7.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 923746ecace763ca5daa2dc22164ee6ddac0e85b904b647d7c1462129c592437; output hash: 4a142dfbd3ffa7133ff7c69a596917d3b0906603e76cbc8d47024ab86df19390.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, numeric_domain_unsupported) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 65bcd63f35df488483c932538a72b2f4e251d1662f89517e0cc52b3850e5a759; output hash: 26bf03c8a5afee2f3e5efe6d1b677bdc54625a9b4ab8d5cd74c6a57965fe5134.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 7175865762116.442101583056708769 | kWh |
| carbon | 2758402798957560.343848526998850684 | gCO2e |
| water_direct | 6576779721425.98684356098500189 | L |
| water_upstream | 22475529153524.908306368291917534 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 08d07ae911c6419d786fc34bb1b1b113d599fbba4f03019ce167b28c5eeab34f; output hash: 4048f410b63afb56e5ba56a25695264e6dc879151704b6d3dbb36c62eea830c5.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 741ab12f8e0cece02b8e6bbdb2148b29a544477c228dba7c6e76e67a4b329f30; output hash: 461490a9a02dad5016d41aa9d9722fd0856e0b5ccf4366f298ae09850d463cba.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## no-execution

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 500; output total unknown; visible thinking unknown.

Observation hash: 9bc97860dc67252cf7f718d3285b046bd9571a61097c921c692937c0d5e0352b.

### original

Status: unavailable. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 527390ff3cd83d0c27e69819b83756908acb5d64a69f63ccf56193fc49858309; output hash: cfab9441dffed9b2b18ee1765b1c142fa97d6efc09da86a6b015f28fec1b58f7.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: f4b15e7adb12eab930ac60f544d1949929e68e40e0c0ab44855fa6536e0f863e; output hash: 39c780c398a7dc831c135a030cb954c1c6e5cb9c43edd4a20f75465428869c14.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 7ee90b4d17d0b986f4b48fe237f99618368708f95ab3ca21a0f13aac1c1607a5; output hash: 40d84622b17fd04080e54c8cad4c3d30c4d4205982776c220fc6cf685ce85da6.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 0c69fcd572f4cc4627feb9e394df9b8d600260ac94ede374bc1010a98b2f02c0; output hash: e6c92afad9fab8bf4faea5d0b484583c38012bbca4969b70984de104b6a7360d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: unavailable. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: f511f1214aa1f4be33e8a4d7ee2577635e859cd008cb83e6eee6c0bcee868ad6; output hash: dd7997c39e4ecd07ce5d46b2d3c6c1d180988a47aa9579d29b89668fdad337df.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, estimate_unavailable, factor_unavailable) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 3982db2939190df2ff54173c2dd5461bffec16279b5adebbf38b204ed43e0647; output hash: 2afd1719a5ca8ba1ddb54f413e504d496ee50b44d3ec7952feeb58474f06ce7e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: ba6be3a54aa14ebe023db0c831144163704632d3c28375f4d29ad2c02bd27ba2; output hash: 76a282ca0089d8824b62880e4da3ed2ba54d002aced697fbcc88971fd2e6c231.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## numeric-language-en

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 100; output total unknown; visible thinking unknown.

Observation hash: 3be200fde7ac65b85d80c54297cf621c8ccbecb97a3c0018cd980beac8168f92.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 5d7c1880a19c2cba50ef483a10a530044173b5656d9b43224afdf857fc6e3a6e; output hash: bdc77babdfacf1d912f26dce66132cadabe1194243d9b73ecabc0e5072893d0d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 87277782b7ae3f140420c03e5fd084bf8d73437c846c9b12aca18fec2e156a4e; output hash: 7b197b1d8f92cd74f2493ae0003c3e4a848d5c296657c3394f249464a77f1219.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 290e59b8aa572e3f49ad01ca7c98a0dd94aa23034367c4c8e1a882b1e20f2f31; output hash: 0961aa964efdeb96a489d0c89f5a6077ae4edda2210be2358f8e7a7280d4fc99.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 4f989951a25021ea6c8a8028ec8036ae56fd368a8cdaf84661ad90db1305f236; output hash: a9f6995e983ed0030961e00f825388b6466c182c2d2b61bde669f8f57075c587.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.03230805011031297 (midpoint; 0.02128784150544899 to 0.04332825871517695) | kWh |
| carbon | 12.419214462404305 (midpoint; 8.183046274694593 to 16.655382650114017) | gCO2e |
| water_direct | 0.015319400427306732 (midpoint; 0.010093984847167062 to 0.0205448160074464) | L |
| water_upstream | 0.10119204375051125 (midpoint; 0.06667564837921677 to 0.13570843912180572) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| usage | gwp | [0.008183046274694593, 0.016655382650114018] | kgCO2eq |
| usage | adpe | [2.097916780361998e-9, 4.269999896380688e-9] | kgSbeq |
| usage | pe | [0.206245123641392, 0.41978150173612033] | MJ |
| usage | wcf | [0.07676963322638385, 0.15625325512925212] | L |
| embodied | gwp | [0.002207685185185185, 0.002207685185185185] | kgCO2eq |
| embodied | adpe | [1.236572523817577e-7, 1.236572523817577e-7] | kgSbeq |
| embodied | pe | [0.02793713033429167, 0.02793713033429167] | MJ |
| total | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| total | gwp | [0.010390731459879777, 0.018863067835299202] | kgCO2eq |
| total | adpe | [1.2575516916211968e-7, 1.2792725227813837e-7] | kgSbeq |
| total | pe | [0.23418225397568368, 0.447718632070412] | MJ |
| total | wcf | [0.07676963322638385, 0.15625325512925212] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.03223024921782546 | 0.03223024921782546 | 414.265803223268163437310431385244163979246119935 | none |
| carbon | 12.389307799332106169 | 12.389307799332106169 | 414.265803223268321611274222748755509670411757306 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.10094836357515112 | 0.10094836357515112 | 414.265803223268270737266163155818222236155171942 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 9c6c34e11d86d5bd28f5991a152aad86f452ce17bd0c3944cce888745844bc89; output hash: 645068b08fdf8f0b106b40715e4a949ee0338df0b9f446d9e70f9f1f3044b04d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: c32fcac05be7fe86e8330c9a4c704ef6ae41331ee9b766effd05728a3624980f; output hash: 8f021cde28487cc4cf0466efefab02168f0abf1adf7319643264bd99d4b70c7b.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: f4ab55cd65fcd5299b89bb1180bc81cbba756c606753b358a530fdb29e861e0d; output hash: 1105b6a1b05f70295a684b22e6fd00359da892fab570dda970430695b670527c.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## numeric-language-de

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag de.

Supplied counts: input 128; answer 100; output total unknown; visible thinking unknown.

Observation hash: 7750d424e339e989dd49093f22f274e33bea75479d16d246b232de596a4acd4d.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: f2eb1afb0fa91c33e8b8b70bef2024427ab33f1e208cd4e50d96f618f193bc13; output hash: dd9e949f44a29764c1a814dfff9f904b1d006d56e64efc281f8bb8f1ebb5ea4c.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: a65f5bd14aa58b0c8957b5de6adcaebb1bbb456477ea5c1c332e4067b9c71a31; output hash: 400f4f8439839e8436a68004cb54c991c5fbe3132c52a8c9601e7ee25d9605b3.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 203b2b2bd87fcc2d36703a32edd08edf5dd5bc92a6985e7ac1c9e2baed087c4f; output hash: 5ab50844a2fce560768b23bc5c6bf9338ec57acfc98be59d172381b1c4847ef0.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 61a45d3bb92203b748cc56b99579ce24b3fec03492d023e3daef79b5a0aebbd5; output hash: 5a5c093fb3e96fd757350ec00d158b067e5b4c6f4c34d8ed7c057c5f1ab4968a.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.03230805011031297 (midpoint; 0.02128784150544899 to 0.04332825871517695) | kWh |
| carbon | 12.419214462404305 (midpoint; 8.183046274694593 to 16.655382650114017) | gCO2e |
| water_direct | 0.015319400427306732 (midpoint; 0.010093984847167062 to 0.0205448160074464) | L |
| water_upstream | 0.10119204375051125 (midpoint; 0.06667564837921677 to 0.13570843912180572) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| usage | gwp | [0.008183046274694593, 0.016655382650114018] | kgCO2eq |
| usage | adpe | [2.097916780361998e-9, 4.269999896380688e-9] | kgSbeq |
| usage | pe | [0.206245123641392, 0.41978150173612033] | MJ |
| usage | wcf | [0.07676963322638385, 0.15625325512925212] | L |
| embodied | gwp | [0.002207685185185185, 0.002207685185185185] | kgCO2eq |
| embodied | adpe | [1.236572523817577e-7, 1.236572523817577e-7] | kgSbeq |
| embodied | pe | [0.02793713033429167, 0.02793713033429167] | MJ |
| total | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| total | gwp | [0.010390731459879777, 0.018863067835299202] | kgCO2eq |
| total | adpe | [1.2575516916211968e-7, 1.2792725227813837e-7] | kgSbeq |
| total | pe | [0.23418225397568368, 0.447718632070412] | MJ |
| total | wcf | [0.07676963322638385, 0.15625325512925212] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.03223024921782546 | 0.03223024921782546 | 414.265803223268163437310431385244163979246119935 | none |
| carbon | 12.389307799332106169 | 12.389307799332106169 | 414.265803223268321611274222748755509670411757306 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.10094836357515112 | 0.10094836357515112 | 414.265803223268270737266163155818222236155171942 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 92fc61a6dc2f5eb4a1e4465daa3e8a4a2360cf31ae0aa4199bd9d9fd1c8561fe; output hash: 962a7f50d0c2e439a92e0bfb75868fdc8a91b290be61ca956ae103721ada8d6c.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 681acca2fcdc697291e3ff8d755952ff4c8ae45689a6d7db26cf6ba86913d85a; output hash: 0ccf8c955a6a41a5d7d4c712a4ba75622277e3216207c87b41714f42cb03e511.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 7b026daa1528cbc2ce9f1dbb61eb3f1b0aefca24211434161f71c3cc3f343ec7; output hash: a01613fad9de77aca9b55e5d22c4fc729da6037bbd49cc5dfdb90b5d160351fa.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## numeric-language-hi

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag hi.

Supplied counts: input 128; answer 100; output total unknown; visible thinking unknown.

Observation hash: e7c34058d41c254c6d622ae023280cdd9b68d0e20ff7e0e46b4bbff10d5c2c60.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 826350b85b7d36cd7966ef13db54470f8f27539788ebe6573669c188d138a18b; output hash: 0ace1b6b4437943cff759e5283401082ea309c1c907f5ba5635262c697d2d39b.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 453a690ab978cc684ba5bf6c6c7edae8ca24a7bc5cfcb92d684aa0f5537e66d9; output hash: ad10201e055029a8a719f9dd38b9f7c611f9808f98fac789686a0845463c7a02.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: ac47d8713991f2d9ff18bf6dc46ebd0e26044844f1e09643c4f5dd0bc9a8f5fe; output hash: 0284af42bb335af6663e99170765415ffbfe74fa78deb8c84e756e77c73b701d.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: c31de3be0ce0863b61772bb401ef48e5d3f9a424b2d66676bb3dbad0a56c27dd; output hash: 51342d699222fcb310afe16d5bc0b0b071d1cf9527a203a70c6cbc5f448a260e.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.03230805011031297 (midpoint; 0.02128784150544899 to 0.04332825871517695) | kWh |
| carbon | 12.419214462404305 (midpoint; 8.183046274694593 to 16.655382650114017) | gCO2e |
| water_direct | 0.015319400427306732 (midpoint; 0.010093984847167062 to 0.0205448160074464) | L |
| water_upstream | 0.10119204375051125 (midpoint; 0.06667564837921677 to 0.13570843912180572) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| usage | gwp | [0.008183046274694593, 0.016655382650114018] | kgCO2eq |
| usage | adpe | [2.097916780361998e-9, 4.269999896380688e-9] | kgSbeq |
| usage | pe | [0.206245123641392, 0.41978150173612033] | MJ |
| usage | wcf | [0.07676963322638385, 0.15625325512925212] | L |
| embodied | gwp | [0.002207685185185185, 0.002207685185185185] | kgCO2eq |
| embodied | adpe | [1.236572523817577e-7, 1.236572523817577e-7] | kgSbeq |
| embodied | pe | [0.02793713033429167, 0.02793713033429167] | MJ |
| total | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| total | gwp | [0.010390731459879777, 0.018863067835299202] | kgCO2eq |
| total | adpe | [1.2575516916211968e-7, 1.2792725227813837e-7] | kgSbeq |
| total | pe | [0.23418225397568368, 0.447718632070412] | MJ |
| total | wcf | [0.07676963322638385, 0.15625325512925212] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.03223024921782546 | 0.03223024921782546 | 414.265803223268163437310431385244163979246119935 | none |
| carbon | 12.389307799332106169 | 12.389307799332106169 | 414.265803223268321611274222748755509670411757306 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.10094836357515112 | 0.10094836357515112 | 414.265803223268270737266163155818222236155171942 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 37919b5527ba99293def6ff7c67ab54165f9b712a432bbbd18d04cc285430eac; output hash: cbae469abd2c2df1ce6e89f4889d6b3e1d649b61b5ee67b289f3b102e7a1bae4.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: b41572183b9de4b45723261c8e0ecff78681e61015975870a77f4d34448d0702; output hash: 09ffa1d09f25c3fdda39fbe707a7771ebe19f4c06f82175cc402d545ff249883.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 9871acf8d9387debad1a9050647de514eeeb0d7fecbb2eacbc87073d4bd30f7f; output hash: 8f66706b6d556b820364674621e7c33fde4b003aa0d4dcae84146ff321c9bfa1.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## numeric-language-zh

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag zh.

Supplied counts: input 128; answer 100; output total unknown; visible thinking unknown.

Observation hash: 2e32576858bfe1daabd3d548a324a7182e0e1508a1464130299847b3fc0a4e66.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 35f88b14b1a22afc267400b46b52f2a0c3a5ffcec12e3aaf95f0e64b928d91c1; output hash: 29a232f51356b7ba1a22c1cffd50167767e8633585dfb2badc789ec200952bc0.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: de0a2ceeb1a874ffcdf782f81e95500ec8a72c2fd122ae2c7b24876a122b1f78; output hash: b353fb0e007a5e93c6d5fcefd57b73961bce7129f2cf45b1ba27488df24f77f7.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: f74e0bed365b790090ec9e241842d116715b0c28732855911556fc5346eb749a; output hash: 1700118f6c14821e9ec3e55f27dd6c69b783233c0460f7282ef6a678d1f56363.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 6c69f267218d4c070113211f82bf86af44a62f1e9b20bd95144432b053a2410f; output hash: a62642622178e86a30934dd8358df2f3c740bfa40d198f519d2e07ad67d3fca9.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.03230805011031297 (midpoint; 0.02128784150544899 to 0.04332825871517695) | kWh |
| carbon | 12.419214462404305 (midpoint; 8.183046274694593 to 16.655382650114017) | gCO2e |
| water_direct | 0.015319400427306732 (midpoint; 0.010093984847167062 to 0.0205448160074464) | L |
| water_upstream | 0.10119204375051125 (midpoint; 0.06667564837921677 to 0.13570843912180572) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| usage | gwp | [0.008183046274694593, 0.016655382650114018] | kgCO2eq |
| usage | adpe | [2.097916780361998e-9, 4.269999896380688e-9] | kgSbeq |
| usage | pe | [0.206245123641392, 0.41978150173612033] | MJ |
| usage | wcf | [0.07676963322638385, 0.15625325512925212] | L |
| embodied | gwp | [0.002207685185185185, 0.002207685185185185] | kgCO2eq |
| embodied | adpe | [1.236572523817577e-7, 1.236572523817577e-7] | kgSbeq |
| embodied | pe | [0.02793713033429167, 0.02793713033429167] | MJ |
| total | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| total | gwp | [0.010390731459879777, 0.018863067835299202] | kgCO2eq |
| total | adpe | [1.2575516916211968e-7, 1.2792725227813837e-7] | kgSbeq |
| total | pe | [0.23418225397568368, 0.447718632070412] | MJ |
| total | wcf | [0.07676963322638385, 0.15625325512925212] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.03223024921782546 | 0.03223024921782546 | 414.265803223268163437310431385244163979246119935 | none |
| carbon | 12.389307799332106169 | 12.389307799332106169 | 414.265803223268321611274222748755509670411757306 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.10094836357515112 | 0.10094836357515112 | 414.265803223268270737266163155818222236155171942 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: c3aa5b0fea53912a68f43429a0823d6b1da7c1954e89ddd3f549284c7c9d76df; output hash: 289986cd9d5b2063a9a2b40da244c765bd9866c8d5559dffc1c980504b09b24f.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 4838147fa8be0c21501719e1ebdb177ea8d2d5e02b05b0814223b9196514e084; output hash: 0dacd143635deefa018074e64245e940bfb5b8c141552787b3162165bf924b46.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 5397ba0b78c77ef0aecc5dda177f6fcb194576bbeb79b04fb624d25db770ba49; output hash: 19e0583a490cd440ee0a9c36ad37161ef80adf4084c9b38562c12687b9e30800.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## numeric-language-mixed

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag mixed.

Supplied counts: input 128; answer 100; output total unknown; visible thinking unknown.

Observation hash: a1d78461da5693345942b80e2e37e78d79c1137aaf6fabb693d086e5ca9016b1.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: e2a76f9e7eca5590b6e48647ac16436ee7404c3cdf9775ce601b263a14724aca; output hash: d7d62b273d45932d143e6c98060c67ba80dd3b3afb88d1e736e9793cc8846ec5.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: fe765d64db2b27d951536b4d8ab5fb1f613813b23634ede2121771de3d188605; output hash: d7083c17e853d9de925aea00d93fb617d0bfbb37ab08da130b8f973bd11cf4b0.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 7dff6bea18f0769fe533a570e077480723c0551a2062aaf857e321a6dd262358; output hash: 77d317397bdcd64981761f644471f39c38c721376610bc660c48bfa59dd11938.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.0007283907475939684 (midpoint; 0.0004988030683259687 to 0.000957978426861968) | kWh |
| carbon | 0.27999340337512146 (midpoint; 0.19173989946450237 to 0.36824690728574055) | gCO2e |
| water_direct | 0.00034537861281747333 (midpoint; 0.00023651578823123017 to 0.0004542414374037165) | L |
| water_upstream | 0.0022813926605390685 (midpoint; 0.0015623010903037667 to 0.0030004842307743704) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| usage | gwp | [0.00019173989946450238, 0.00036824690728574054] | kgCO2eq |
| usage | adpe | [4.915704238352422e-11, 9.440877396724696e-11] | kgSbeq |
| usage | pe | [0.004832603647169315, 0.00928127819080949] | MJ |
| usage | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |
| embodied | gwp | [0.000030496080858085802, 0.000030496080858085802] | kgCO2eq |
| embodied | adpe | [1.7081518654148518e-9, 1.7081518654148518e-9] | kgSbeq |
| embodied | pe | [0.00038591235350704013, 0.00038591235350704013] | MJ |
| total | energy | [0.0004988030683259687, 0.000957978426861968] | kWh |
| total | gwp | [0.00022223598032258818, 0.00039874298814382636] | kgCO2eq |
| total | adpe | [1.757308907798376e-9, 1.8025606393820988e-9] | kgSbeq |
| total | pe | [0.005218516000676355, 0.00966719054431653] | MJ |
| total | wcf | [0.0017988168785349969, 0.0034547256681780867] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.0006505898551064584 | 0.0006505898551064584 | 8.36224154126384600087184650935578101371849564401 | none |
| carbon | 0.250086740302922629 | 0.250086740302922629 | 8.36224154126385030590379626622848263332284096592 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0020377124851789385 | 0.0020377124851789385 | 8.36224154126384903386026396047976877853284892703 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 7fc02a1b281aa4d2a42ac3c10785fe235417f04a04a24b094125baf46e21c211; output hash: 0bcac603137c2f41c164717520310e5c53bf66f5825e724f54e52d2dbc23d032.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.03230805011031297 (midpoint; 0.02128784150544899 to 0.04332825871517695) | kWh |
| carbon | 12.419214462404305 (midpoint; 8.183046274694593 to 16.655382650114017) | gCO2e |
| water_direct | 0.015319400427306732 (midpoint; 0.010093984847167062 to 0.0205448160074464) | L |
| water_upstream | 0.10119204375051125 (midpoint; 0.06667564837921677 to 0.13570843912180572) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| usage | gwp | [0.008183046274694593, 0.016655382650114018] | kgCO2eq |
| usage | adpe | [2.097916780361998e-9, 4.269999896380688e-9] | kgSbeq |
| usage | pe | [0.206245123641392, 0.41978150173612033] | MJ |
| usage | wcf | [0.07676963322638385, 0.15625325512925212] | L |
| embodied | gwp | [0.002207685185185185, 0.002207685185185185] | kgCO2eq |
| embodied | adpe | [1.236572523817577e-7, 1.236572523817577e-7] | kgSbeq |
| embodied | pe | [0.02793713033429167, 0.02793713033429167] | MJ |
| total | energy | [0.02128784150544899, 0.04332825871517695] | kWh |
| total | gwp | [0.010390731459879777, 0.018863067835299202] | kgCO2eq |
| total | adpe | [1.2575516916211968e-7, 1.2792725227813837e-7] | kgSbeq |
| total | pe | [0.23418225397568368, 0.447718632070412] | MJ |
| total | wcf | [0.07676963322638385, 0.15625325512925212] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.03223024921782546 | 0.03223024921782546 | 414.265803223268163437310431385244163979246119935 | none |
| carbon | 12.389307799332106169 | 12.389307799332106169 | 414.265803223268321611274222748755509670411757306 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.10094836357515112 | 0.10094836357515112 | 414.265803223268270737266163155818222236155171942 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: fe7d0e1d84373c3c1fb3f508237e17edad9cb21d1668acfc1b4b09be0a74f711; output hash: 2dba53875d3c2ee9f97b10c70d5cd36a7a1df390a168e01b7f2d5aa6ceb6c4ab.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00007780089248751 | kWh |
| carbon | 0.029906663072198831 | gCO2e |
| water_direct | 0.000071305588619287 | L |
| water_upstream | 0.00024368017536013 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 7c4c4c48c389fa8d83bf341ba4cf71cae472045b82ba28b606195562958d3f74; output hash: fc8cbf955f59bca897601bcaaaff8284776e13f5e089fa9505b0dfe1dad26c2f.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 9cbcedc027faef2b7d262e3b0f564e794ed599915a41baa35c2bc1f6efe2c7ec; output hash: 8d7b2ade42001f53580216675a96ca7ff319570b4cd07084a8410f3c18a03022.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## inclusive-output-with-thinking

Numeric fixture: live, chatgpt, observed model chatgpt-gpt-5-5, language tag en.

Supplied counts: input 128; answer 100; output total 300; visible thinking 200.

Observation hash: c83c5b387bb69d0d0b2a96be5499bbf599f9fc328cd12aeb476a1646ad801549.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: df2588b886e0dd8711372ccd4b19ff38c34ad21c2d72ff41a0848256e68a60ea; output hash: 64eeec52a80f216a209cad2ad71e76b0a52b7b329bc242c0650dcc0008a6f39a.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00023340267746253 | kWh |
| carbon | 0.089719989216596492 | gCO2e |
| water_direct | 0.00021391676585786 | L |
| water_upstream | 0.00073104052608039 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: de1dea915126f23cb4bc6cfe98ae2d60631538568c04a1a4b6324e8ef0b8b3d2; output hash: eef75b9daeb939c1ed28d0a093e230bb0308ddfe17c846307b4ada0581b57321.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.002016172242781906 (midpoint; 0.0013274092049779065 to 0.0027049352805859047) | kWh |
| carbon | 0.7750166101253646 (midpoint; 0.5102560983935073 to 1.0397771218572218) | gCO2e |
| water_direct | 0.0009560016717857535 (midpoint; 0.000629413198027024 to 0.001282590145544483) | L |
| water_upstream | 0.0063148530816172065 (midpoint; 0.004157578370911301 to 0.008472127792323111) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0013274092049779065, 0.0027049352805859047] | kWh |
| usage | gwp | [0.0005102560983935073, 0.0010397771218572218] | kgCO2eq |
| usage | adpe | [1.308161771505727e-10, 2.665713719017409e-10] | kgSbeq |
| usage | pe | [0.012860471341507949, 0.02620649497242848] | MJ |
| usage | wcf | [0.004786991568938325, 0.009754717937867594] | L |
| embodied | gwp | [0.000056279909240924096, 0.000056279909240924096] | kgCO2eq |
| embodied | adpe | [3.152360213190269e-9, 3.152360213190269e-9] | kgSbeq |
| embodied | pe | [0.0007121935546865189, 0.0007121935546865189] | MJ |
| total | energy | [0.0013274092049779065, 0.0027049352805859047] | kWh |
| total | gwp | [0.0005665360076344314, 0.0010960570310981459] | kgCO2eq |
| total | adpe | [3.2831763903408415e-9, 3.4189315850920096e-9] | kgSbeq |
| total | pe | [0.013572664896194468, 0.026918688527114997] | MJ |
| total | wcf | [0.004786991568938325, 0.009754717937867594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.001782769565319376 | 0.001782769565319376 | 7.63817101286500137879545791270310430774293631833 | none |
| carbon | 0.685296620908768108 | 0.685296620908768108 | 7.63817101286500448988411220075887225957226243865 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0055838125555368165 | 0.0055838125555368165 | 7.63817101286500214117511520540645442772262276545 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile openai/gpt-5.5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 685ba5710a4fde0edc14d25cda07887cfdeb625f4c0ed23e757f7145b45bd156; output hash: a0cdbee687e2123128c0f59329fe85105ccd0db5bb1e38997dc5874387f234e2.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.002016172242781906 (midpoint; 0.0013274092049779065 to 0.0027049352805859047) | kWh |
| carbon | 0.7750166101253646 (midpoint; 0.5102560983935073 to 1.0397771218572218) | gCO2e |
| water_direct | 0.0009560016717857535 (midpoint; 0.000629413198027024 to 0.001282590145544483) | L |
| water_upstream | 0.0063148530816172065 (midpoint; 0.004157578370911301 to 0.008472127792323111) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.0013274092049779065, 0.0027049352805859047] | kWh |
| usage | gwp | [0.0005102560983935073, 0.0010397771218572218] | kgCO2eq |
| usage | adpe | [1.308161771505727e-10, 2.665713719017409e-10] | kgSbeq |
| usage | pe | [0.012860471341507949, 0.02620649497242848] | MJ |
| usage | wcf | [0.004786991568938325, 0.009754717937867594] | L |
| embodied | gwp | [0.000056279909240924096, 0.000056279909240924096] | kgCO2eq |
| embodied | adpe | [3.152360213190269e-9, 3.152360213190269e-9] | kgSbeq |
| embodied | pe | [0.0007121935546865189, 0.0007121935546865189] | MJ |
| total | energy | [0.0013274092049779065, 0.0027049352805859047] | kWh |
| total | gwp | [0.0005665360076344314, 0.0010960570310981459] | kgCO2eq |
| total | adpe | [3.2831763903408415e-9, 3.4189315850920096e-9] | kgSbeq |
| total | pe | [0.013572664896194468, 0.026918688527114997] | MJ |
| total | wcf | [0.004786991568938325, 0.009754717937867594] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.001782769565319376 | 0.001782769565319376 | 7.63817101286500137879545791270310430774293631833 | none |
| carbon | 0.685296620908768108 | 0.685296620908768108 | 7.63817101286500448988411220075887225957226243865 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.0055838125555368165 | 0.0055838125555368165 | 7.63817101286500214117511520540645442772262276545 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: model_override; profile openai/gpt-5.5-pro.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 38555ee6394eeb40e1d519438f71e0ffe336eafde50613827716b81dfe02bec3; output hash: 31749c6c4f05287ea0d34c5b2ca4f126467a6a1dcd09cecf9a31cb45307080a3.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.07850815033093891 (midpoint; 0.04544752451634697 to 0.11156877614553086) | kWh |
| carbon | 30.178532987212918 (midpoint; 17.470028424083775 to 42.887037550342065) | gCO2e |
| water_direct | 0.037225947948586864 (midpoint; 0.021549701208167852 to 0.05290219468900588) | L |
| water_upstream | 0.24589537765153377 (midpoint; 0.14234619153765032 to 0.3494445637654172) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_proxy, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.04544752451634697, 0.11156877614553086] | kWh |
| usage | gwp | [0.017470028424083777, 0.042887037550342066] | kgCO2eq |
| usage | adpe | [4.4788535410859936e-9, 1.0995102889142067e-8] | kgSbeq |
| usage | pe | [0.44031379652417596, 1.0809229308083612] | MJ |
| usage | wcf | [0.16389589274581817, 0.4023467584544231] | L |
| embodied | gwp | [0.002786388888888889, 0.002786388888888889] | kgCO2eq |
| embodied | adpe | [1.5607170640960596e-7, 1.5607170640960596e-7] | kgSbeq |
| embodied | pe | [0.035260330627431086, 0.035260330627431086] | MJ |
| total | energy | [0.04544752451634697, 0.11156877614553086] | kWh |
| total | gwp | [0.020256417312972667, 0.04567342643923095] | kgCO2eq |
| total | adpe | [1.6055055995069195e-7, 1.6706680929874804e-7] | kgSbeq |
| total | pe | [0.4755741271516071, 1.1161832614357923] | MJ |
| total | wcf | [0.16389589274581817, 0.4023467584544231] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision.; model-arch-multimodal: The model architecture is multimodal, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0.07827474765347638 | 0.07827474765347638 | 335.363537832775940467067326120545522489718828216 | none |
| carbon | 30.088812997996321508 | 30.088812997996321508 | 335.363537832776101529742873544287437756013705512 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.24516433712545338 | 0.24516433712545338 | 335.363537832776052135888199950211717272159108794 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: original_fallback; profile none.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: a92e41e120701f699dc0ffdce73aa366d920ee2a90d10ad64a5e82bc32160238; output hash: 68686033f9209878037e1d51e6abcff4545637d2e4627a4b6260ff736987db20.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, original_engine_fallback. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.00023340267746253 | kWh |
| carbon | 0.089719989216596492 | gCO2e |
| water_direct | 0.00021391676585786 | L |
| water_upstream | 0.00073104052608039 | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, factor_unavailable) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | 0 | 0 | 0 | none |
| carbon | 0 | 0 | 0 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | 0 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 653a670114c5b6523903e35a51ee8bf706f2361d44f136d37f25904a916b867e; output hash: f3513616c65dc14e03f3b3d38f6f4060693dd26e7c692c61294af95dbda5efb2.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, model_override) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: unavailable; profile none.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: cbde2843a88909772e30bfba92d45c99f260cf6b14712fa8b78b6b8efc71d6c1; output hash: 1948f08012e001a0196fcff2ab095481a6bd1d16534e327992434c4b108032ba.

Reasons: unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | kWh |
| carbon | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | gCO2e |
| water_direct | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_upstream | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |
| water_total | Unavailable (unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, unsupported_workload) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | candidate_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## history-response

Numeric fixture: history, claude, observed model claude-haiku-4-5, language tag de.

Supplied counts: input unknown; answer 320; output total unknown; visible thinking unknown.

Observation hash: 207bfdf6e3292a977eb818e5369b3fe6f5e1680a8835b4e8162fabe3bc0f0eaf.

### original

Status: estimated. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 31a52b2cad13a5301f155883d253a51c7e29d3ce31c47459e6d44c96ce24d160; output hash: 9c60dce969240480bd832c1809451c7db54a307b6d370344fe0fae920ccfb4a6.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000248962855960032 | kWh |
| carbon | 0.095701321831036258 | gCO2e |
| water_direct | 0.000228177883581717 | L |
| water_upstream | 0.000779776561152416 | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | L |

Original raw profile: command-a-03-2025-h100-reference. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 857c1db114c07bd6bd00c48fdd9291c47eaf3869a90e0fe074b8383901504027; output hash: 4b83db423833456afb4cd0d6ff7e07f26be8ed9d28ba1157c9c02e29e153bb50.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 9d74bb1e285da80cc7d2cef023c00c3624c51913afa4b77b7de3edc7528fe80b; output hash: 613e209eefbc42bdbb89fa89b134a39b2a6f0f1b1ef0ba71bc0b07e347cb0406.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: b46a5133d7ade31fe0e24cfb20765b85f48180691946673e98199981721de237; output hash: 76f975a65c850cab004eca3bc608d667e119dee9d2ce2b6f9eaef413f80aecf1.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: f178fd4918f306bc7dbf44a3ce5f42fb3d6dd383b3f01835cda31c7dcb167b72; output hash: b79163209821e82f123ee483a4acf7c9ac0058c69404ae435abce55abd5ce9b5.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 1e27cdf4e467da0b7524d0ece04bb89e63e6c84d87bb4b7354554201b2a2b473; output hash: 38e75da5b2bb379f7e03023b263376447f70f344368d7c77c2dca6e076e0bb16.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: estimated. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: 9a200f07fdd55f060d19e08f46b891fd25cd7cb6ffd32f0155240236a3bbdffc; output hash: d698e61c53fc0f9a673b76305c981cfc8273374c22cab5ea079feae4aa42de2f.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | 0.000035789011275808973 (midpoint; 0.00001979204315846434 to 0.000051785979393153606) | kWh |
| carbon | 0.01375729593442097 (midpoint; 0.007608061390113693 to 0.019906530478728247) | gCO2e |
| water_direct | 0.00002387069516219351 (midpoint; 0.0000023605189088076735 to 0.000045380871415579346) | L |
| water_upstream | 0.00011209476221696127 (midpoint; 0.00006199065837662616 to 0.0001621988660572964) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, source_warning, factor_incompatible) | L |

Raw EcoLogits phases (source units and endpoint ranges):

| Phase | Quantity | Value | Unit |
| --- | --- | --- | --- |
| usage | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| usage | gwp | [0.000007608061390113693, 0.000019906530478728248] | kgCO2eq |
| usage | adpe | [1.950505853266661e-12, 5.103508269195288e-12] | kgSbeq |
| usage | pe | [0.0001917532309364659, 0.0005017232827526294] | MJ |
| usage | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |
| embodied | gwp | [8.415858129688234e-7, 0.0000016831716259376468] | kgCO2eq |
| embodied | adpe | [4.713905314650334e-11, 9.427810629300668e-11] | kgSbeq |
| embodied | pe | [0.000010649839344022524, 0.000021299678688045048] | MJ |
| total | energy | [0.00001979204315846434, 0.000051785979393153606] | kWh |
| total | gwp | [0.000008449647203082517, 0.000021589702104665896] | kgCO2eq |
| total | adpe | [4.9089558999770004e-11, 9.938161456220197e-11] | kgSbeq |
| total | pe | [0.00020240307028048844, 0.0005230229614406744] | MJ |
| total | wcf | [0.00006435117728543383, 0.00020757973747287573] | L |

Raw warnings: model-arch-not-released: The model architecture has not been released, expect lower precision..

Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | -0.000213173844684223027 | 0.000213173844684223027 | -0.856247587063531800742819398778462782939707281108 | none |
| carbon | -0.081944025896615288 | 0.081944025896615288 | -0.856247587063531728315363423630565522872835302325 | none |
| water_direct | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | -0.00066768179893545473 | 0.00066768179893545473 | -0.856247587063531777239614593442809192267861452367 | none |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## history-prompt

Numeric fixture: history, claude, observed model claude-haiku-4-5, language tag zh.

Supplied counts: input unknown; answer 50; output total unknown; visible thinking unknown.

Observation hash: 392fbab77a9ec3eb1201ffd8f62106fbc0357b3a7703be5dbe52d106a4236664.

### original

Status: unavailable. Selection: legacy_reference; profile none.

Requested: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Effective: ecologits-reference-2026-09-10-v1 (7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9).

Input hash: 48b8f7ec5bf443a05ef2dac937c0f5bd5cb2364810f42ac2768a4f136169a6ac; output hash: 50c468d4a21812b20bce5a60ef9f38e48eb20a49c0f8f19c3e65e753ac88c40b.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved) | L |

Original raw profile: none. Original raw output is retained in JSON; it supplies no embodied phase.

### ecologits-configured

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Effective: ecologits-0.11.1-6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e (6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e).

Input hash: 6590732723ab198ec16b081339d509c79ed5b63f27bccf9498321bd125f296da; output hash: 2b3f277c84ebc22d69656b231bbb6443d753d8839f0dee985417441496c4bca6.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### ecologits-original-fallback

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Effective: ecologits-0.11.1-81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379 (81793b985bd98341239df52785a2d9acd18927dc0582b58c81962a750c5c9379).

Input hash: 06516c91117fafd50d43633449ab329bd13eb46b974673240f66d911f678a9e1; output hash: b8ba51d047f4c540c036c100023d7ad0883442578f00a5d0ff00b28ea82702da.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### model-override

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Effective: ecologits-0.11.1-0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0 (0254a0fa7fabc3fc900e63e3400f2c04b3663b0a33657daa6178af1c26f114b0).

Input hash: 3b1aea8c742b151daa180cd8eab6a166ab45f3ca429191accc7b847903422bc4; output hash: 0338f2eae806e2e3523c10a5584a2b5bca6d5e26c2301c9197d6258dc020a933.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### original-model-override

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Effective: ecologits-0.11.1-d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1 (d76a0d984ba5f05a7101bc3b7876915a46d52d9eda4a3b751c683c0ea09b44a1).

Input hash: a6fefa309904140695c33017cadb00f8709a6776dc48c7b756ef78abe69294e4; output hash: 037385f190712ff7dc9e631254e2e2219f33affc54e597a09cb2265a6899fa6d.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unavailable-policy

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Effective: ecologits-0.11.1-33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1 (33b93e2914c001db9578d9272afe66a80a3de83c383075723583e471ee921de1).

Input hash: 570e8c184e703be425fa68d9ca39e9aab04b9393e032d30f84de923c2b9190d5; output hash: 3ccc174d601d3afebb4854bf0250be76c0a2520f2f68a05b7037f05ba4cd4479.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

### unsupported-video-profile

Status: unavailable. Selection: direct_mapping; profile anthropic/claude-haiku-4-5.

Requested: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Effective: ecologits-0.11.1-67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e (67677916b27df7cf18e027aa836c5decd58b550eb0c3b64fac25684a01cce96e).

Input hash: de09be751329c4ba21786129b6b48f028102b50e58ce01d3aedaad6e1957eb5a; output hash: dfceeeddfeecb90c2926abf5bf711f701a1b2e0cb6ff08ecf55eb63beea5de35.

Reasons: history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable. Missing components: extra_input_length_effect, hidden_reasoning, search_and_tools, document_and_image_processing, training, hardware_manufacturing, employee_device_and_network, direct_refrigerant_and_fuel, compatible_total_water_scope, provider_execution_unobserved.

| Operational usage quantity | Value | Unit |
| --- | --- | --- |
| energy | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | kWh |
| carbon | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | gCO2e |
| water_direct | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_upstream | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |
| water_total | Unavailable (history_only, unvalidated_reference, input_length_not_modelled, hidden_reasoning_unobserved, provider_environment_assumed, not_applicable) | L |

Raw result unavailable.

Deltas from the original displayed operational value:

| Quantity | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- |
| energy | Unavailable | Unavailable | Unavailable | reference_unavailable |
| carbon | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_direct | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_upstream | Unavailable | Unavailable | Unavailable | reference_unavailable |
| water_total | Unavailable | Unavailable | Unavailable | reference_unavailable |

## Controlled mathematical inputs

Protocol: controlled-operational-text-1. These calls bypass provider/cohort selection and use existing mathematical functions with declared common inputs. They do not create or register a production method.

- No consumer-provider mapping, observed architecture or physical hardware equivalence is claimed.
- Ranged architectures, models above the legacy 200-billion bound, alternative timing and nontext workloads are outside this common-input protocol.
- Original supplies no embodied GWP, ADPe or primary-energy calculation. Raw EcoLogits values remain inspectable without a cross-engine delta.
- Direct water has unresolved source coverage; total water scopes are incompatible. Equal factors do not establish common coverage.
- EcoLogits-only ADPe and primary-energy factors are synthetic zero placeholders outside compared quantities. Embodied defaults are retained and are not shared original-engine parameters.
- Decimal versus binary64 representation, exponential evaluation and operation order remain intentional arithmetic differences.

### shared-8b-baseline

Status: computed; reason none. Profile: llama-3.1-8b-h100-reference; active 8.03 and total 8.03 billion parameters; output 500 tokens.

Environment: ecologits-0.11.1-cohere-usa-reference; PUE 1.09; carbon 384.4 gCO2e/kWh facility; direct water 0.999 L/kWh IT; upstream water 3.1321 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: 1e45cdca941884691290af39b7ef913de8e942921dc1fc3b77c13ba9c2dfd0ed; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0.0000405066644764735514533897687826761842542621171283 | 0.000040506664476473554 | kWh | 0.0000000000000000000025466102312173238157457378828717 | 0.0000000000000000000025466102312173238157457378828717 | 0.0000000000000000628689195748617173182625009212743440894112766163 | none |
| carbon | 0.0155707618247564331786830271200607252273383578241 | 0.015570761824756434 | gCO2e | 0.0000000000000000008213169728799392747726616421759 | 0.0000000000000000008213169728799392747726616421759 | 0.0000000000000000527473852675661736759668443597695356874990502529 | none |
| water_direct | 0.0000371249154238505301852627330402692734587228027625 | 0.00003712491542385053 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.000126870923806762810507162094804220076702774377058 | 0.00012687092380676281 | L | -0.000000000000000000000507162094804220076702774377058 | 0.000000000000000000000507162094804220076702774377058 | -0.00000000000000000399746513690307012230419443564878128171370011497 | none |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original bff7f463a7a179176b60d23bfd34f2050ae9be826f1ae6cc1d7464dce870a8d6; ecologits 04f413a6c7697544295a0150d9da030230e28efc6f106d9fec8ebe7316c9b40c.

### shared-70b-baseline

Status: computed; reason none. Profile: llama-3.1-70b-h100-reference; active 70.55 and total 70.55 billion parameters; output 500 tokens.

Environment: ecologits-0.11.1-cohere-usa-reference; PUE 1.09; carbon 384.4 gCO2e/kWh facility; direct water 0.999 L/kWh IT; upstream water 3.1321 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: 43d0be780abd3a8538734ddc8a374cf641656e318171c6741b44d700898b69dd; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0.000299840121432349574165087826957810609782412136188 | 0.0002998401214323496 | kWh | 0.000000000000000000025834912173042189390217587863812 | 0.000000000000000000025834912173042189390217587863812 | 0.0000000000000000861622922563787219925928559551931745637896611152 | none |
| carbon | 0.115258542678595176309059760682582398400359225151 | 0.11525854267859519 | gCO2e | 0.000000000000000013690940239317417601599640774849 | 0.000000000000000013690940239317417601599640774849 | 0.000000000000000118784603042356365719689099793835681164828169096 | none |
| water_direct | 0.000274807597532951582193507100120048439607917178029 | 0.00027480759753295157 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.000939129244338262101242471582814558610899493051754 | 0.000939129244338262 | L | -0.000000000000000000101242471582814558610899493051754 | 0.000000000000000000101242471582814558610899493051754 | -0.000000000000000107804620283284822541665837937198144363898729597 | none |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original 8256cd40c9ce8c655196dc8a5d75d8bfe32dda64f075b6e2e3969b398174e433; ecologits 7887bc9f4d18919e37220e1909349cc4e05da448490fcd8452b9ef358950534c.

### shared-104b-baseline

Status: computed; reason none. Profile: command-r-plus-08-2024-h100-reference; active 104 and total 104 billion parameters; output 500 tokens.

Environment: ecologits-0.11.1-cohere-usa-reference; PUE 1.09; carbon 384.4 gCO2e/kWh facility; direct water 0.999 L/kWh IT; upstream water 3.1321 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: e15d4e3c668eaab3e1ecf49d05f81d3f31d4222a631ff9c34b110f9a1f635ce7; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0.000373574292177070176714010359725192110806107188712 | 0.0003735742921770702 | kWh | 0.000000000000000000023285989640274807889193892811288 | 0.000000000000000000023285989640274807889193892811288 | 0.0000000000000000623329552592379683512433032251269346793652343534 | none |
| carbon | 0.143601957912865775928865582278363847393867603341 | 0.14360195791286579 | gCO2e | 0.000000000000000014071134417721636152606132396659 | 0.000000000000000014071134417721636152606132396659 | 0.0000000000000000979870652338853419447690469628242323197234646964 | none |
| water_direct | 0.000342385979710911106914950779234373319903945946352 | 0.0003423859797109111 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.00117007204052780150048595184769527421025580832576 | 0.0011700720405278015 | L | -0.00000000000000000000048595184769527421025580832576 | 0.00000000000000000000048595184769527421025580832576 | -0.000000000000000000415317887158528124674171300699742587001402440297 | none |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original 7fc382b29a7ab78dc290c36445690c2a61cce010f4d14142471e381f8c229e2a; ecologits 9f3e70a4f32e7fd24408aadfebc7b5a2904409aeaf53dcd1928549a6200b7ca2.

### shared-111b-baseline

Status: computed; reason none. Profile: command-a-03-2025-h100-reference; active 111 and total 111 billion parameters; output 500 tokens.

Environment: ecologits-0.11.1-cohere-usa-reference; PUE 1.09; carbon 384.4 gCO2e/kWh facility; direct water 0.999 L/kWh IT; upstream water 3.1321 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: 9616c33619886bb3ecbb7458936552a5f21d435019f2ba3ee308bf410817cffd; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0.000389004462437549824482095792591310810571902864874 | 0.00038900446243754976 | kWh | -0.000000000000000000064482095792591310810571902864874 | 0.000000000000000000064482095792591310810571902864874 | -0.000000000000000165761840850201472600941919575509753632010433928 | none |
| carbon | 0.149533315360994152530917622672099875583839461258 | 0.14953331536099412 | gCO2e | -0.000000000000000032530917622672099875583839461258 | 0.000000000000000032530917622672099875583839461258 | -0.000000000000000217549631292116777414267489855483026391966657298 | none |
| water_direct | 0.000356527943096433279502397886971302293359019231201 | 0.0003565279430964332 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.00121840087680064980526037223197524458979225696307 | 0.0012184008768006496 | L | -0.00000000000000000020526037223197524458979225696307 | 0.00000000000000000020526037223197524458979225696307 | -0.000000000000000168467026034124546216081660225853354481484465341 | none |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original 2316087cf08435cecb58bfad0fa290766e9b77d5c006fb43ce2686e005221581; ecologits 4224c176a47040fdbe8ebedc2cf203acda92a46f0deec4705723a9b948bb6893.

### shared-111b-unity

Status: computed; reason none. Profile: command-a-03-2025-h100-reference; active 111 and total 111 billion parameters; output 500 tokens.

Environment: synthetic-unity-comparison-1; PUE 1; carbon 1000 gCO2e/kWh facility; direct water 0 L/kWh IT; upstream water 1 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: d464e8f910ca337f93b2f39401f88620e5aad98d05bee225ca810aeb64103a5e; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0.000356884827924357637139537424395697991350369600802 | 0.00035688482792435756 | kWh | -0.000000000000000000077139537424395697991350369600802 | 0.000000000000000000077139537424395697991350369600802 | -0.000000000000000216146866968369856657856956329921882584027879825 | none |
| carbon | 0.356884827924357637139537424395697991350369600802 | 0.35688482792435755 | gCO2e | -0.000000000000000087139537424395697991350369600802 | 0.000000000000000087139537424395697991350369600802 | -0.000000000000000244167111085106355954814808402528370437754877157 | none |
| water_direct | 0 | 0 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0.000356884827924357637139537424395697991350369600802 | 0.00035688482792435756 | L | -0.000000000000000000077139537424395697991350369600802 | 0.000000000000000000077139537424395697991350369600802 | -0.000000000000000216146866968369856657856956329921882584027879825 | none |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original 67566d605ecca0577a8ca1deb13970fd4c87cb084f997495762a20b7087e43c9; ecologits aebe8670520be57b5e27f4a29c8f873b1291a6b51b6d011e75e8729237b70ff2.

### shared-zero

Status: computed; reason none. Profile: command-a-03-2025-h100-reference; active 111 and total 111 billion parameters; output 0 tokens.

Environment: synthetic-unity-comparison-1; PUE 1; carbon 1000 gCO2e/kWh facility; direct water 0 L/kWh IT; upstream water 1 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: 51d403586b204c639eea09e65c84cc16b9fa886c8536f43262773a75a943d208; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| energy | 0 | 0 | kWh | 0 | 0 | Unavailable | zero_reference_value |
| carbon | 0 | 0 | gCO2e | 0 | 0 | Unavailable | zero_reference_value |
| water_direct | 0 | 0 | L | Unavailable | Unavailable | Unavailable | incompatible_scope |
| water_upstream | 0 | 0 | L | 0 | 0 | Unavailable | zero_reference_value |
| water_total | Unavailable | Unavailable | L | Unavailable | Unavailable | Unavailable | reference_unavailable |

Output hashes: original 18c852b7422e173fd09bdaddb7197a42d6dcd69014cf38703b98a5cb2b7b7b24; ecologits 10362b32ce0d3ef10c0c88dccdc8ca3648e32463a8a84d545a502c8e71f30a0f.

### shared-unsafe-count

Status: unavailable; reason numeric_domain_unsupported. Profile: command-a-03-2025-h100-reference; active 111 and total 111 billion parameters; output 9007199254740992 tokens.

Environment: ecologits-0.11.1-cohere-usa-reference; PUE 1.09; carbon 384.4 gCO2e/kWh facility; direct water 0.999 L/kWh IT; upstream water 3.1321 L/kWh facility.

Shared settings: {"gpuMemoryGb":"80","precisionBits":"16","batchSize":"64","memoryMultiplier":"1.2","hostPowerKw":"1.2","serverGpuCount":"8"}. Shared regression coefficients: {"energyAlpha":"0.0000011665273170451914","energyBeta":"-0.011205921025579175","energyGamma":"0.00004052928146734005","latencyAlpha":"0.0006785088094353663","latencyBeta":"0.0003119310311688259","latencyGamma":"0.019473717579473387"}. Timing: regression, no measured cap or TPS/TTFT override.

Control hash: 644f97a8c929b4fd6d2f545e60c8abf280c1394fa6fbeed59f9c6606b7154c0b; protocol hash a7ca7f9d2922f12d1801c7c9810f7e043d3450ef80fcc88334337c52d2f03476; original source bundle 7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9; EcoLogits core 0.11.1-port.2. Full input, source identity, intermediates and raw phases remain in JSON.

