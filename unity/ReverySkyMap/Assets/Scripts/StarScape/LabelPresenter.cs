using System.Collections.Generic;
using TMPro;
using UnityEngine;

public enum LabelHighlightState
{
  Normal,
  Focused,
  Linked
}

public sealed class LabelPresenter : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] relatedBehaviours;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;
  [SerializeField] private Material normalMaterialPreset;
  [SerializeField] private Material focusedMaterialPreset;
  [SerializeField] private Material linkedMaterialPreset;

  private List<TMP_Text> texts;
  private bool distanceVisible;
  private LabelHighlightState highlightState;

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;

    entry = new CullingManager.Entry
    {
      node = node != null ? node : this,
      referenceTransform = reference,
      consumer = this,
      radius = radius,
      visibleDistance = visibleDistance
    };

    return true;
  }

  public void SetDistanceVisible(Component node, bool visible)
  {
    distanceVisible = visible;
    ApplyVisibility();
  }

  public void SetHighlightState(LabelHighlightState state)
  {
    if (highlightState == state)
      return;

    highlightState = state;
    ApplyTextMaterial();
    ApplyVisibility();
  }

  private void ApplyVisibility()
  {
    bool visible = distanceVisible || highlightState != LabelHighlightState.Normal;
    SetRelatedBehavioursVisible(visible);

    if (labelRoot.activeSelf != visible)
      labelRoot.SetActive(visible);
  }

  private void ApplyTextMaterial()
  {
    if (labelRoot == null)
      return;

    texts ??= new List<TMP_Text>();
    labelRoot.GetComponentsInChildren<TMP_Text>(true, texts);
    for (int i = 0; i < texts.Count; i++)
    {
      TMP_Text text = texts[i];
      Material nextMaterial = ResolveMaterialPreset();

      if (text.fontSharedMaterial != nextMaterial)
        text.fontSharedMaterial = nextMaterial;
    }
  }

  private Material ResolveMaterialPreset()
  {
    return highlightState switch
    {
      LabelHighlightState.Focused => focusedMaterialPreset,
      LabelHighlightState.Linked => linkedMaterialPreset,
      _ => normalMaterialPreset
    };
  }

  private void SetRelatedBehavioursVisible(bool visible)
  {
    if (relatedBehaviours == null)
      return;

    for (int i = 0; i < relatedBehaviours.Length; i++)
    {
      Behaviour behaviour = relatedBehaviours[i];
      if (behaviour != null && behaviour.enabled != visible)
        behaviour.enabled = visible;
    }
  }
}
