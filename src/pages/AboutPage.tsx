import type { TranslateFn } from '../app/i18n'

interface AboutPageProps {
  t: TranslateFn
}

export function AboutPage(props: AboutPageProps) {
  const { t } = props


  return (
    <section className="panel main-panel about-panel">
      <h1>{t('route.about')}</h1>

      <div className="about-content">
        <div className="about-avatar">
          <img src="./avatar.jpg" alt="avatar" />
        </div>

        <div className="about-info">
          <h2 className="about-nickname-zh">洛斯里克金牌码农</h2>
          <h3 className="about-nickname-en">Lothric Golden Coder</h3>
          <p className="about-bio">全职 AI 应用创业者</p>
          <p className="about-email">
            <a href="mailto:chenmutime@outlook.com">chenmutime@outlook.com</a>
          </p>
          <p className="about-wechat">微信号：moon19340431520</p>
        </div>
      </div>

    </section>
  )
}
