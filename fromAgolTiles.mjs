import Map from 'ol/Map';
import View from 'ol/View';
import TileGrid from 'ol/tilegrid/TileGrid';
import VectorTileSource from 'ol/source/VectorTile';
import XYZSource from 'ol/source/XYZ';
import VectorTileLayer from 'ol/layer/VectorTile';
import ImageTileLayer from 'ol/layer/Tile';
import MVT from 'ol/format/MVT';
import {getCenter} from 'ol/extent';
import {applyStyle, applyBackground} from 'ol-mapbox-style';
import proj4 from 'proj4';

function getJsonServiceUrl(serviceUrl) {
  const url = new URL(serviceUrl);
  const search = url.search;
  if (!search) {
    return `${serviceUrl}?f=pjson`
  } else if (search.indexOf('f=pjson') === -1) {
    return `${serviceUrl}&f=pjson`
  }
  return serviceUrl;
}

function makeAbsoluteUrlFromRelative(baseUrl, relativePath) {
  if (relativePath.indexOf('http') === -1) {
    let url = `${baseUrl.split('?')[0]}`;
    if (url === baseUrl) {
      url = `${url.substring(0, url.lastIndexOf('/'))}`;
    }
    if (url.lastIndexOf('/') !== url.length - 1) {
      url = `${url}/`;
    } 
    return `${url}${relativePath}`;
  }
  return relativePath;
}

function getServiceDefinition(serviceUrl) {
  return new Promise((resolve, reject) => {
    fetch(serviceUrl).then(response => {
      response.json().then(serviceDefinition => {
        resolve(serviceDefinition);
      });
    }).catch(err => {
      console.error(`Failed to create get service definition from service ${serviceUrl}`, err);
    });
  });
}

function getTileUrls(serviceUrl, serviceDefinition) {
  const tileUrls = [];
  const tiles = serviceDefinition.tiles;
  if (tiles) {
    tiles.forEach(url => {
      tileUrls.push(makeAbsoluteUrlFromRelative(serviceUrl, url));
    });
    return tileUrls;  
  }
  let format = serviceDefinition.tileInfo.format;
  format = format === 'MIXED' ? '' : `.${format}`;
  return [makeAbsoluteUrlFromRelative(serviceUrl, `tile/{z}/{y}/{x}${format}`)];
}

function getGetTileGrid(serviceDefinition) {
  const esriExtent = serviceDefinition.fullExtent;
  const extent = [esriExtent.xmin, esriExtent.ymin, esriExtent.xmax, esriExtent.ymax];
  const tileInfo = serviceDefinition.tileInfo;
  const origin = [tileInfo.origin.x, tileInfo.origin.y];
  const lods = tileInfo.lods;
  const tileSize = [tileInfo.cols, tileInfo.rows];
  const resolutions = [];
  lods.forEach(lod => {
    resolutions.push(lod.resolution);
  });
  return new TileGrid({origin, extent, tileSize, resolutions});
}

function createImageLayer(serviceUrl, serviceDefinition) {
  return new Promise((resolve, reject) => {
    const tileInfo = serviceDefinition.tileInfo;
    const layer = new ImageTileLayer({
      declutter: true,
      source: new XYZSource({
        projection: `EPSG:${tileInfo.spatialReference.latestWkid}`,
        tileGrid: getGetTileGrid(serviceDefinition),
        urls: getTileUrls(serviceUrl, serviceDefinition)
      })
    });
    resolve(layer);
  }).catch(err => console.error(`Failed to create ImageTileLayer from service ${serviceUrl}`, err));
}

function createVectorLayer(serviceUrl, serviceDefinition) {
  return new Promise((resolve, reject) => {
    const tileInfo = serviceDefinition.tileInfo;
    const tileGrid = getGetTileGrid(serviceDefinition);
    const styleUrl = makeAbsoluteUrlFromRelative(serviceUrl, 'resources/styles/root.json');
    const options = {
      resolutions: tileGrid.getResolutions(),
      updateSource: false
    };
    const layer = new VectorTileLayer({
      declutter: true,
      source: new VectorTileSource({
        format: new MVT(),
        projection: `EPSG:${tileInfo.spatialReference.latestWkid}`,
        tileGrid,
        urls: getTileUrls(serviceUrl, serviceDefinition)
      })
    });
    fetch(styleUrl).then(response => {
      response.json().then(mbStyle => {
        mbStyle.glyphs = makeAbsoluteUrlFromRelative(styleUrl, mbStyle.glyphs);
        mbStyle.sprite = makeAbsoluteUrlFromRelative(styleUrl, mbStyle.sprite);
        applyStyle(layer, mbStyle, '', options);
        applyBackground(layer, mbStyle);
        layer._mbStyle = mbStyle;
        resolve(layer);
      });
    });
  }).catch(err => console.error(`Failed to create VectorTileLayer from service ${serviceUrl}`, err));
}

export function createLayer(serviceUrl) {
  serviceUrl = getJsonServiceUrl(serviceUrl);
  return new Promise((resolve, reject) => {
    getServiceDefinition(serviceUrl).then(serviceDefinition => {
      if (serviceDefinition.tileInfo.format === 'pbf') {
        resolve(createVectorLayer(serviceUrl, serviceDefinition));
      } else {
        resolve(createImageLayer(serviceUrl, serviceDefinition));
      }
    });
  });
}

export function createBasemap(serviceUrl) {
  serviceUrl = getJsonServiceUrl(serviceUrl);
  return new Promise((resolve, reject) => {
    createLayer(serviceUrl).then(layer => {
      const mbStyle = layer._mbStyle;
      const source = layer.getSource();
      const tileGrid = source.getTileGrid();
      const projection = source.getProjection();
      const resolutions = tileGrid.getResolutions();
      const extent = tileGrid.getExtent();
      const zoom = mbStyle?.zoom !== undefined ? mbStyle.zoom : 9;
      let center = mbStyle?.center;
      if (center) {
        center = proj4('EPSG:4326', projection.getCode(), center);
      } else {
        center = getCenter(extent);
      }
      const map = new Map({
        target: 'map',
        view: new View({
          center,
          zoom,
          projection,
          maxResolution: resolutions[0],
          minResolution: resolutions[resolutions.length - 1]
        }),
        layers: [layer]
      });
      resolve(map);
    });
  }).catch(err => console.error(`Failed to create Map from service ${serviceUrl}`, err));
}
