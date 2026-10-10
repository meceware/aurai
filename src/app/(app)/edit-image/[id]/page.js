import { ImageSessionPage, imageSessionMetadata } from '../../_image-tool/session-page';

export const generateMetadata = imageSessionMetadata;

export default function EditImageSessionPage({ params }) {
  return <ImageSessionPage params={params} mode="edit" />;
}
