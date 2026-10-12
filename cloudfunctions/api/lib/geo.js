'use strict';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function haversineMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const deltaLat = toRadians(latitudeB - latitudeA);
  const deltaLng = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(latA) *
      Math.cos(latB) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((EARTH_RADIUS_METERS * c).toFixed(2));
}

function roundCoordinate(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

module.exports = {
  EARTH_RADIUS_METERS,
  haversineMeters,
  roundCoordinate
};
