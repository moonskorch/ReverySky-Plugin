using System.Collections.Generic;
using TMPro;
using UnityEngine;

public sealed class LabelPresenter : MonoBehaviour
{
  [SerializeField] private NodeVisibility visibilitySource;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] relatedBehaviours;
  [SerializeField] private LabelHighlightPresenter highlightPresenter;

  private List<TMP_Text> texts;
  private bool modeAllowed = true;
  private LabelHighlightState highlightState;

  private void Start()
  {
    if (visibilitySource == null)
      visibilitySource = GetComponentInParent<NodeVisibility>();

    SubscribeToVisibilitySource();
    ApplyTextMaterial();
    ApplyVisibility();
  }

  private void OnDestroy()
  {
    UnsubscribeFromVisibilitySource();
  }

  public void SetModeAllowed(bool allowed)
  {
    if (modeAllowed == allowed)
      return;

    modeAllowed = allowed;
    ApplyVisibility();
  }

  private void SubscribeToVisibilitySource()
  {
    highlightState = LabelHighlightState.Normal;

    if (visibilitySource == null)
      return;

    highlightState = visibilitySource.HighlightState;
    visibilitySource.OnDistanceVisibilityChanged += HandleDistanceVisibilityChanged;
    visibilitySource.OnHighlightStateChanged += HandleHighlightStateChanged;
  }

  private void UnsubscribeFromVisibilitySource()
  {
    if (visibilitySource == null)
      return;

    visibilitySource.OnDistanceVisibilityChanged -= HandleDistanceVisibilityChanged;
    visibilitySource.OnHighlightStateChanged -= HandleHighlightStateChanged;
  }

  private void HandleDistanceVisibilityChanged(bool visible)
  {
    ApplyVisibility();
  }

  private void HandleHighlightStateChanged(LabelHighlightState state)
  {
    highlightState = state;
    ApplyTextMaterial();
    ApplyVisibility();
  }

  private void ApplyVisibility()
  {
    bool visible = modeAllowed &&
      visibilitySource != null &&
      (visibilitySource.IsDistanceVisible || highlightState != LabelHighlightState.Normal);
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
    highlightPresenter.Apply(texts, highlightState);
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
