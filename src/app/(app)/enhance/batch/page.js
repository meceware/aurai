import { ImageBatchPage } from '../../_image-tool/batch-page';

export const metadata = { title: 'Enhance' };

export default function EnhanceBatchPage({ searchParams }) {
  return <ImageBatchPage searchParams={searchParams} mode="enhance" />;
}
