import React from 'react';
import DailyReportSettings from '../components/DailyReportSettings';
import Layout from '../components/Layout';

const WorkdayCheckIns = () => (
  <Layout
    title="Work Requirements"
    eyebrow="Settings · Superadmin"
    heading="Work Requirements"
    description="Choose whether task descriptions, start-of-day plans and end-of-day summaries are required."
  >
    <DailyReportSettings />
  </Layout>
);

export default WorkdayCheckIns;
