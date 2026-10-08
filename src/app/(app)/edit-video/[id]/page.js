import { VideoSessionPage, videoSessionMetadata } from '../../_video-tool/session-page';

export const generateMetadata = videoSessionMetadata;

export default function EditVideoSessionPage({ params }) {
  return <VideoSessionPage params={params} tool="edit" />;
}
