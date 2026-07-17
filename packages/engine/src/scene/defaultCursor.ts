/**
 * Built-in fallback cursor: a 40x56 anti-aliased arrow PNG (2x of a 20x28
 * logical cursor), used when the host provides no texture for a shape id.
 */
export const DEFAULT_CURSOR_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAA4CAYAAACPKLr2AAAEC0lEQVR42u3ZbUhkVRjAcXuljYqgvzo64/uumriWK0VlQl9S/BQJQaCL4IdM/KayKipiYiIiIiqIlEFERQwWFZKSEiVmETX1QbCShWUJDMn3t2z2ac7t3jjc3HYGndnzwQceHO8cZ36ee+5zzrk3DogzOePOgFEGPg48aTLwFeAn4BmTgQL8CDxlMlDlD7fjdEcCVPk98ITJQJXfAUXGAT0ej478FrhkFLCsrEyysrJ05Dd2GTIDWF1dLWNjY5KZmakjvwYeMwa4u7trITMyMnTkAnDRCODR0ZEcHh7K6OiopKen68h5IN8IoIqDgwMZHh6WtLQ0HfklkGcE0EEODQ25kV8AjxoBVLG/vy+Dg4OSmprqAG8Ac0COEUAHOTAw4EZ+DlwwAugg+/v7JSUlRUfOAOeNAKrY29uTvr4+N/IzINMIoIPs7e0Vn8+nI6eADCOAKlQx7+npcSM/BdKMADrI7u5u8Xq9DjIYWlx8DKQaAVSxs7MjXV1dbuRHgM8IoIrt7W3p7Ox0IycBrxFAFVtbW9LR0SHJyck60g8kGwF0kG1tbW7kB0CSEUAVm5ub0traKklJSTry/VshYwZUsbGxIc3NzW7ku4DHCKCK9fV1aWpq0pF/habEd4DEmALVcmxlZUWWlpb+kwsLC1JXV6dvxBTybSAhJsC1tTVpbGyUgoICyc7Ovmlq87aDfAuIP3VgMBi00omRkRFJTEyUY/bUt8oj4E3+iZMD1e8zMzNSX19vpXqtTm1NTY3+pdeBqxHkL0DziYFq8zQxMSE5OTn/YnJzc2V6etqah+Pj453ji/YmPz2CPFkPqmWV2o+49shWVlZWyuLiouTn5zvHDoDLMVtuqflVLadcAzwAbKjX6u7D3NycNDQ06O/PAg9HHbi6uiotLS365H/D3hM/ba/5rONqPM7Pz+unfxd4MarAqqoq64u12hW0l/S5dtuXgD31Xl5ennWaa2tr9V78BHggasDCwkJJSEjQa5bftUp+BPjKad/e3i6zs7P6ON0ESmNxf/BPu6B6btJevS9FRUUSCASsntf+9j3gvmgC94Ehu7eOa++1Lxirt9V+eWpqSt8zr4X2zM9GC6gGejfw4P+0vwNotcenlJSUWHNvRUWF/k++Adxz2kBVQq4A58L40GzgV+eurCrmfr9fv/J/i+QWcjjA34FXgXvD/NC7gH67BEl5ebksLy9bP7VeHLTbnRj4PPAycHeEV98lu6esnpucnJTx8XG9RF0N91ZdtG7dqjE24fRYaWmpFBcX6ysc1buvhfLO2/kw8Tngj2PKlMJdCw2Z18MZNtEE3g98qMHUlf2zDbsY7rCJ9nOOF+wKELDXeOfDOa2xBD5kz9E+u0aePXE/A54BTzv/BuzZgvv1leTvAAAAAElFTkSuQmCC';

/** Hotspot (arrow tip) in pixels of the embedded image. */
export const DEFAULT_CURSOR_HOTSPOT = { x: 8, y: 4 };

/** Pixel size of the embedded image. */
export const DEFAULT_CURSOR_SIZE_PX = { w: 40, h: 56 };

/** The embedded image is rendered at 2x; treat it as 20x28 logical points. */
export const DEFAULT_CURSOR_PIXEL_RATIO = 2;
