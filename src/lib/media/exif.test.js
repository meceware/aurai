import { test } from 'node:test';
import assert from 'node:assert/strict';
import exifReader from 'exif-reader';
import sharp from 'sharp';
import { encodeWithExif, exifFor } from './exif.js';

test('copies capture date and camera, never location', async () => {
  const original = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#a85' } })
    .withExif({
      IFD0: { Make: 'Kodak', Model: 'Brownie', DateTime: '1962:07:14 10:30:00' },
      IFD2: { DateTimeOriginal: '1962:07:14 10:30:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '60/1 10/1 0/1' },
    })
    .jpeg()
    .toBuffer();

  const exif = await exifFor(original);
  assert.equal(exif.IFD0.Make, 'Kodak');
  assert.equal(exif.IFD2.DateTimeOriginal, '1962:07:14 10:30:00');

  const output = await encodeWithExif(sharp(original), { mime: 'image/jpeg', quality: 90, exif });
  const written = exifReader((await sharp(output).metadata()).exif);
  assert.equal(written.Image.Model, 'Brownie');
  assert.equal(written.Image.Software, 'Aurai');
  assert.equal(written.GPSInfo, undefined, 'no location');
});

test('an original without EXIF gives none', async () => {
  const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
  assert.equal(await exifFor(plain), null);
});
