import { ImageBatchPage } from '../../_image-tool/batch-page';

export const metadata = { title: 'Upscale' };

export default function UpscaleBatchPage({ searchParams }) {
  return <ImageBatchPage searchParams={searchParams} mode="upscale" />;
}
