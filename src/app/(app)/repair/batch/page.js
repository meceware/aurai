import { ImageBatchPage } from '../../_image-tool/batch-page';

export const metadata = { title: 'Repair' };

export default function RepairBatchPage({ searchParams }) {
  return <ImageBatchPage searchParams={searchParams} mode="repair" />;
}
