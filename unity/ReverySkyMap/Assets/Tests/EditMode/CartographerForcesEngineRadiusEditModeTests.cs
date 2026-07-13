using NUnit.Framework;

public class CartographerForcesEngineRadiusEditModeTests
{
  [TestCase(-10, 4f)]
  [TestCase(0, 4f)]
  [TestCase(250, 6f)]
  [TestCase(500, 8f)]
  [TestCase(750, 8f)]
  public void CalculateIdealEdgeLength_LinearlyGrowsToCap(
    int noteCount,
    float expected)
  {
    float actual =
      CartographerForcesEngine.CalculateIdealEdgeLength(
        noteCount,
        4f,
        8f,
        500);

    Assert.That(actual, Is.EqualTo(expected).Within(0.0001f));
  }

  [Test]
  public void CalculateLayoutRadii_SameInputs_GiveSameResults()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      3.8f,
      6f,
      0.65f,
      out float firstBoundRadius,
      out float firstSpawnRadius);

    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      3.8f,
      6f,
      0.65f,
      out float secondBoundRadius,
      out float secondSpawnRadius);

    Assert.That(firstBoundRadius, Is.EqualTo(secondBoundRadius));
    Assert.That(firstSpawnRadius, Is.EqualTo(secondSpawnRadius));
  }

  [Test]
  public void CalculateLayoutRadii_MorePhysicalNodes_GrowBoundRadius()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      50,
      3.8f,
      6f,
      0.65f,
      out float smallBoundRadius,
      out float smallSpawnRadius);

    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      3.8f,
      6f,
      0.65f,
      out float largeBoundRadius,
      out float largeSpawnRadius);

    Assert.That(largeBoundRadius, Is.GreaterThan(smallBoundRadius));
    Assert.That(largeSpawnRadius, Is.GreaterThan(smallSpawnRadius));
  }

  [TestCase(0)]
  [TestCase(-10)]
  public void CalculateLayoutRadii_ZeroOrNegativeInputs_AreNormalizedSafely(int totalNodeCount)
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      totalNodeCount,
      3.8f,
      6f,
      0.65f,
      out float boundRadius,
      out float spawnRadius);

    Assert.That(boundRadius, Is.GreaterThan(0f));
    Assert.That(spawnRadius, Is.GreaterThan(0f));
    Assert.That(spawnRadius, Is.LessThanOrEqualTo(boundRadius));
  }

  [TestCase(0)]
  [TestCase(1)]
  [TestCase(10)]
  [TestCase(50)]
  [TestCase(100)]
  [TestCase(200)]
  [TestCase(1000)]
  [TestCase(10000)]
  public void CalculateLayoutRadii_SpawnRadius_RemainsInsideBoundRadius(int totalNodeCount)
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      totalNodeCount,
      3.8f,
      6f,
      0.65f,
      out float boundRadius,
      out float spawnRadius);

    Assert.That(boundRadius, Is.GreaterThan(0f));
    Assert.That(spawnRadius, Is.GreaterThan(0f));
    Assert.That(spawnRadius, Is.LessThanOrEqualTo(boundRadius));
  }

  [Test]
  public void CalculateLayoutRadii_NodeSpacingFactor_ChangesBoundRadius()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      2.5f,
      6f,
      0.65f,
      out float compactBoundRadius,
      out float compactSpawnRadius);

    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      5.0f,
      6f,
      0.65f,
      out float roomyBoundRadius,
      out float roomySpawnRadius);

    Assert.That(roomyBoundRadius, Is.GreaterThan(compactBoundRadius));
    Assert.That(roomySpawnRadius, Is.GreaterThan(compactSpawnRadius));
  }

  [Test]
  public void CalculateLayoutRadii_SpawnFillRatio_ChangesOnlySpawnRadius()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      3.8f,
      6f,
      0.25f,
      out float lowFillBoundRadius,
      out float lowFillSpawnRadius);

    CartographerForcesEngine.CalculateLayoutRadii(
      200,
      3.8f,
      6f,
      0.9f,
      out float highFillBoundRadius,
      out float highFillSpawnRadius);

    Assert.That(lowFillBoundRadius, Is.EqualTo(highFillBoundRadius));
    Assert.That(highFillSpawnRadius, Is.GreaterThan(lowFillSpawnRadius));
  }

  [Test]
  public void CalculateLayoutRadii_MinimumBoundRadius_AffectsSmallGraphs()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      1,
      3.8f,
      4f,
      0.65f,
      out float smallMinimumBoundRadius,
      out float smallMinimumSpawnRadius);

    CartographerForcesEngine.CalculateLayoutRadii(
      1,
      3.8f,
      10f,
      0.65f,
      out float largerMinimumBoundRadius,
      out float largerMinimumSpawnRadius);

    Assert.That(largerMinimumBoundRadius, Is.GreaterThan(smallMinimumBoundRadius));
    Assert.That(largerMinimumSpawnRadius, Is.GreaterThan(smallMinimumSpawnRadius));
  }

  [Test]
  public void CalculateLayoutRadii_ResultRemainsFinite()
  {
    CartographerForcesEngine.CalculateLayoutRadii(
      10000,
      3.8f,
      6f,
      0.65f,
      out float boundRadius,
      out float spawnRadius);

    Assert.That(float.IsNaN(boundRadius), Is.False);
    Assert.That(float.IsInfinity(boundRadius), Is.False);
    Assert.That(float.IsNaN(spawnRadius), Is.False);
    Assert.That(float.IsInfinity(spawnRadius), Is.False);
  }
}
