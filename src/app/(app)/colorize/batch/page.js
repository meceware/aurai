import { ImageBatchPage } from '../../_image-tool/batch-page';

export const metadata = { title: 'Colorize' };

export default function ColorizeBatchPage({ searchParams }) {
  return <ImageBatchPage searchParams={searchParams} mode="colorize" />;
}
