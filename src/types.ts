export interface InfoboxField {
  label: string;
  value: string;
}

export interface Infobox {
  image_search: string;
  image_caption: string;
  fields: InfoboxField[];
}

export interface ArticleImage {
  search: string;
  caption: string;
  float: 'left' | 'right';
}

export interface Section {
  title: string;
  level: 2 | 3;
  content: string;
  images: ArticleImage[];
}

export interface Reference {
  author: string;
  year: string;
  title: string;
  publication: string;
  pages: string;
}

export interface Category {
  label: string;
  slug: string;
}

export interface Article {
  displayTitle: string;
  hatnote: string | null;
  lead: string;
  infobox: Infobox;
  sections: Section[];
  references: Reference[];
  categories: Category[];
}
