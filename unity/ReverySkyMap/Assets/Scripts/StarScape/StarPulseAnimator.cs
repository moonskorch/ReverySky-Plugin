using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class StarPulseAnimator : MonoBehaviour
{
  [SerializeField, Min(0.05f)]
  private float duration = 0.3f;

  [SerializeField]
  private AnimationCurve scaleCurve;

  private readonly Dictionary<Transform, PulseState> activePulses = new();

  private sealed class PulseState
  {
    public Vector3 BaseScale;
    public Coroutine Coroutine;
  }

  public void Play(Transform target)
  {
    if (target == null || scaleCurve == null || scaleCurve.length == 0)
      return;

    Vector3 baseScale;

    if (activePulses.TryGetValue(target, out var existing))
    {
      baseScale = existing.BaseScale;

      if (existing.Coroutine != null)
        StopCoroutine(existing.Coroutine);

      target.localScale = baseScale;
      activePulses.Remove(target);
    }
    else
    {
      baseScale = target.localScale;
    }

    var state = new PulseState
    {
      BaseScale = baseScale
    };

    state.Coroutine = StartCoroutine(PulseRoutine(target, state));
    activePulses.Add(target, state);
  }

  private IEnumerator PulseRoutine(Transform target, PulseState state)
  {
    float elapsed = 0f;

    while (elapsed < duration)
    {
      if (target == null)
      {
        activePulses.Remove(target);
        yield break;
      }

      elapsed += Time.deltaTime;

      float t = Mathf.Clamp01(elapsed / duration);
      float multiplier = scaleCurve.Evaluate(t);

      target.localScale = state.BaseScale * multiplier;

      yield return null;
    }

    if (target != null)
      target.localScale = state.BaseScale;

    activePulses.Remove(target);
  }
}