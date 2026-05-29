using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

public static class Rng
{
  /// <summary>
  /// Returns true ~50% of the time (fair coin flip).
  /// </summary>
  /// <returns></returns>
  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static bool Coin() 
    => Chance(0.5f);

  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static bool Chance(float probability)
    => UnityEngine.Random.value < probability;


  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static T Pick<T>(IReadOnlyList<T> list)
  {
    var listCount = list?.Count ?? 0;
    if (listCount == 0) 
      return default;
    return list[UnityEngine.Random.Range(0, listCount)];
  }

  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static T Pick<T>(IReadOnlyList<T> list, int stableSeed)
  {
    var listCount = list?.Count ?? 0;
    if (listCount == 0)
      return default;

    var seededRandom = new Random(stableSeed);
    return list[seededRandom.Next(0, listCount)];
  }

  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static int Range(int minInclusive, int maxExclusive)
    => UnityEngine.Random.Range(minInclusive, maxExclusive);

  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static float Range(float minInclusive, float maxInclusive)
    => UnityEngine.Random.Range(minInclusive, maxInclusive);

  [MethodImpl(MethodImplOptions.AggressiveInlining)]
  public static TEnum RandomEnum<TEnum>() where TEnum : struct, Enum
  {
    var values = (TEnum[])Enum.GetValues(typeof(TEnum));
    return values[UnityEngine.Random.Range(0, values.Length)];
  }
}
