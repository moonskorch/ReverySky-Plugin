using System;
using System.Linq;
using UnityEngine;

[CreateAssetMenu()]
public class StarSO : ScriptableObject
{
  [SerializeField] private GameObject prefab;

  [Header("Scale")]
  [SerializeField] private float minScale = 0.5f;
  [SerializeField] private float maxScale = 1.6f;
  [SerializeField, Range(0f, 0.4f)] private float shortNotePercentile = 0.10f;
  [SerializeField, Range(0.6f, 1f)] private float longNotePercentile = 0.85f;
  [SerializeField, Min(1)] private int minSignificantLengthDiff = 50;

  private int cachedNotesVersion = -1;
  private int noteLengthSampleCount;
  private float shortNoteLength;
  private float medianNoteLength;
  private float longNoteLength;

  public Star Instantiate(Vector3 worldPosition, NoteData noteData, Transform parent)
  {
    GameObject go = Instantiate(
      prefab,
      worldPosition,
      Quaternion.Euler(0f, Rng.Range(0, 360), 0f),
      parent);

    EnsureRuntimeScaleStats();
    float scaleFactor = EvaluateNoteLengthScale(
      noteData != null ? noteData.Length : 0,
      minScale,
      maxScale);
    go.transform.localScale *= scaleFactor;

    var star = go.GetComponent<Star>();
    star.SetData(noteData);

    return star;
  }

  private void EnsureRuntimeScaleStats()
  {
    int version = MapRuntimeContext.NotesVersion;
    if (cachedNotesVersion == version)
      return;

    cachedNotesVersion = version;

    var lengths = MapRuntimeContext.Notes?
      .Where(x => x != null)
      .Select(x => Mathf.Max(0, x.Length))
      .OrderBy(x => x)
      .ToArray() ?? Array.Empty<int>();

    noteLengthSampleCount = lengths.Length;

    if (noteLengthSampleCount == 0)
    {
      shortNoteLength = 0f;
      medianNoteLength = 0f;
      longNoteLength = 0f;
      return;
    }

    if (noteLengthSampleCount == 1)
    {
      shortNoteLength = lengths[0];
      medianNoteLength = lengths[0];
      longNoteLength = lengths[0];
      return;
    }

    shortNoteLength = GetPercentileSorted(lengths, shortNotePercentile);
    medianNoteLength = GetPercentileSorted(lengths, 0.50f);
    longNoteLength = GetPercentileSorted(lengths, longNotePercentile);

    if (shortNoteLength > medianNoteLength)
      shortNoteLength = medianNoteLength;

    if (longNoteLength < medianNoteLength)
      longNoteLength = medianNoteLength;
  }

  private float EvaluateNoteLengthScale(int noteLength, float minScaleValue, float maxScaleValue)
  {
    if (noteLengthSampleCount <= 1)
      return 1f;

    float length = Mathf.Max(0, noteLength);

    float effectiveShort = Mathf.Min(
      shortNoteLength,
      medianNoteLength - minSignificantLengthDiff);

    float effectiveLong = Mathf.Max(
      longNoteLength,
      medianNoteLength + minSignificantLengthDiff);

    effectiveShort = Mathf.Max(0f, effectiveShort);
    effectiveLong = Mathf.Max(medianNoteLength, effectiveLong);

    if (Mathf.Approximately(length, medianNoteLength))
      return 1f;

    if (length < medianNoteLength)
    {
      if (Mathf.Approximately(effectiveShort, medianNoteLength))
        return 1f;

      if (length <= effectiveShort)
        return minScaleValue;

      float t = Mathf.InverseLerp(effectiveShort, medianNoteLength, length);
      return Mathf.Lerp(minScaleValue, 1f, t);
    }

    if (Mathf.Approximately(medianNoteLength, effectiveLong))
      return 1f;

    if (length >= effectiveLong)
      return maxScaleValue;

    float upperT = Mathf.InverseLerp(medianNoteLength, effectiveLong, length);
    return Mathf.Lerp(1f, maxScaleValue, upperT);
  }

  private static float GetPercentileSorted(int[] sortedValues, float percentile)
  {
    if (sortedValues == null || sortedValues.Length == 0)
      return 0f;

    if (sortedValues.Length == 1)
      return sortedValues[0];

    percentile = Mathf.Clamp01(percentile);

    float index = (sortedValues.Length - 1) * percentile;
    int lowerIndex = Mathf.FloorToInt(index);
    int upperIndex = Mathf.CeilToInt(index);

    if (lowerIndex == upperIndex)
      return sortedValues[lowerIndex];

    float t = index - lowerIndex;
    return Mathf.Lerp(sortedValues[lowerIndex], sortedValues[upperIndex], t);
  }
}
