using System;

/// <summary>
/// Identity for a visual graph node within one engine-built map.
/// The value is based on Unity's scene component instance id and is valid until the map graph is rebuilt.
/// </summary>
public readonly struct MapGraphNodeId : IEquatable<MapGraphNodeId>
{
  public static readonly MapGraphNodeId None = new(0);

  public MapGraphNodeId(int value)
  {
    Value = value;
  }

  /// <summary>
  /// Unity instance id of the indexed scene component.
  /// </summary>
  public int Value { get; }
  public bool IsValid => Value != 0;

  public bool Equals(MapGraphNodeId other)
  {
    return Value == other.Value;
  }

  public override bool Equals(object obj)
  {
    return obj is MapGraphNodeId other && Equals(other);
  }

  public override int GetHashCode()
  {
    return Value;
  }

  public override string ToString()
  {
    return Value.ToString();
  }
}
