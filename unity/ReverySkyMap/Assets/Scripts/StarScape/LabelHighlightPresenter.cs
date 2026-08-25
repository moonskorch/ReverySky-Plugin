using System.Collections.Generic;
using TMPro;
using UnityEngine;

[DisallowMultipleComponent]
public sealed class LabelHighlightPresenter : MonoBehaviour
{
  [SerializeField] private Material normalMaterialPreset;
  [SerializeField] private Material focusedMaterialPreset;
  [SerializeField] private Material linkedMaterialPreset;

  public void Apply(IReadOnlyList<TMP_Text> texts, LabelHighlightState state)
  {
    if (texts == null)
      return;

    Material nextMaterial = ResolveMaterialPreset(state);
    for (int i = 0; i < texts.Count; i++)
      Apply(texts[i], nextMaterial);
  }

  public void Apply(TMP_Text text, LabelHighlightState state)
    => Apply(text, ResolveMaterialPreset(state));

  private Material ResolveMaterialPreset(LabelHighlightState state)
  {
    return state switch
    {
      LabelHighlightState.Focused => focusedMaterialPreset,
      LabelHighlightState.Linked => linkedMaterialPreset,
      _ => normalMaterialPreset
    };
  }

  private static void Apply(TMP_Text text, Material material)
  {
    if (text != null && text.fontSharedMaterial != material)
      text.fontSharedMaterial = material;
  }
}
